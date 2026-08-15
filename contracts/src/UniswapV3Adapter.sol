// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IEntryAdapter } from "./interfaces/IEntryAdapter.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        returns (uint256 amountIn);
}

/// @notice Uniswap V3-compatible adapter restricted to a fixed settlement token and fee tier.
/// @dev Supports constituent/settlement swaps and constituent/settlement/constituent rebalances.
contract UniswapV3Adapter is ITradeAdapter, IEntryAdapter {
    using SafeTransferLib for address;

    error NotOwner();
    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidRouter(address router);
    error InvalidFee(uint24 fee);
    error InvalidPath();
    error InvalidAmount();
    error Slippage(uint256 received, uint256 minimum);
    error InputMismatch(uint256 reported, uint256 observed);
    error OutputMismatch(uint256 expected, uint256 observed);
    error Reentrancy();

    event CallerApprovalChanged(address indexed caller, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public immutable uniswapRouter;
    address public immutable settlementToken;
    uint24 public immutable poolFee;
    mapping(address => bool) public isCallerApproved;

    bool private _entered;

    constructor(
        address initialOwner,
        address uniswapRouter_,
        address settlementToken_,
        uint24 poolFee_
    ) {
        if (initialOwner == address(0) || settlementToken_ == address(0)) {
            revert ZeroAddress();
        }
        if (uniswapRouter_ == address(0) || uniswapRouter_.code.length == 0) {
            revert InvalidRouter(uniswapRouter_);
        }
        if (settlementToken_.code.length == 0) revert ZeroAddress();
        if (poolFee_ == 0) revert InvalidFee(poolFee_);
        owner = initialOwner;
        uniswapRouter = uniswapRouter_;
        settlementToken = settlementToken_;
        poolFee = poolFee_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyApprovedCaller() {
        if (!isCallerApproved[msg.sender]) revert UnauthorizedCaller(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function setCallerApproved(address caller, bool approved) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        isCallerApproved[caller] = approved;
        emit CallerApprovalChanged(caller, approved);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) revert InvalidAmount();
        address[] memory path = abi.decode(data, (address[]));
        _validatePath(path, tokenIn, tokenOut);

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        tokenIn.safeApprove(uniswapRouter, 0);
        tokenIn.safeApprove(uniswapRouter, amountIn);

        uint256 reportedOutput;
        if (path.length == 2) {
            reportedOutput = IUniswapV3SwapRouter(uniswapRouter)
                .exactInputSingle(
                    IUniswapV3SwapRouter.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: poolFee,
                    recipient: msg.sender,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
                );
        } else {
            reportedOutput = IUniswapV3SwapRouter(uniswapRouter)
                .exactInput(
                    IUniswapV3SwapRouter.ExactInputParams({
                    path: _encodePath(path),
                    recipient: msg.sender,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut
                })
                );
        }
        tokenIn.safeApprove(uniswapRouter, 0);

        uint256 observedInput = inputBefore - IERC20(tokenIn).balanceOf(address(this));
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - outputBefore;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        if (reportedOutput != amountOut) revert OutputMismatch(reportedOutput, amountOut);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
    }

    function buyExactOutput(
        address settlementToken_,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        bytes calldata data
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountIn) {
        if (
            amountOut == 0 || maxAmountIn == 0 || settlementToken_ != settlementToken
                || settlementToken_ == tokenOut
        ) revert InvalidAmount();
        address[] memory path = abi.decode(data, (address[]));
        if (path.length != 2) revert InvalidPath();
        _validatePath(path, settlementToken_, tokenOut);

        uint256 adapterInputBefore = IERC20(settlementToken_).balanceOf(address(this));
        uint256 callerOutputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        settlementToken_.safeTransferFrom(msg.sender, address(this), maxAmountIn);
        uint256 pulled = IERC20(settlementToken_).balanceOf(address(this)) - adapterInputBefore;
        if (pulled != maxAmountIn) revert InputMismatch(maxAmountIn, pulled);

        settlementToken_.safeApprove(uniswapRouter, 0);
        settlementToken_.safeApprove(uniswapRouter, maxAmountIn);
        amountIn = IUniswapV3SwapRouter(uniswapRouter)
            .exactOutputSingle(
                IUniswapV3SwapRouter.ExactOutputSingleParams({
                tokenIn: settlementToken_,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: msg.sender,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn,
                sqrtPriceLimitX96: 0
            })
            );
        settlementToken_.safeApprove(uniswapRouter, 0);

        uint256 observedOutput = IERC20(tokenOut).balanceOf(msg.sender) - callerOutputBefore;
        if (observedOutput != amountOut) revert OutputMismatch(amountOut, observedOutput);
        uint256 adapterInputAfterSwap = IERC20(settlementToken_).balanceOf(address(this));
        uint256 observedInput = adapterInputBefore + maxAmountIn - adapterInputAfterSwap;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        uint256 refund = maxAmountIn - amountIn;
        if (refund != 0) settlementToken_.safeTransfer(msg.sender, refund);
        uint256 adapterInputAfter = IERC20(settlementToken_).balanceOf(address(this));
        if (adapterInputAfter != adapterInputBefore) {
            revert InputMismatch(amountIn, adapterInputBefore + maxAmountIn - adapterInputAfter);
        }
    }

    function _validatePath(address[] memory path, address tokenIn, address tokenOut) private view {
        if (
            (path.length != 2 && path.length != 3) || path[0] != tokenIn
                || path[path.length - 1] != tokenOut || tokenIn == address(0)
                || tokenOut == address(0)
        ) revert InvalidPath();

        if (path.length == 2) {
            if (path[0] != settlementToken && path[1] != settlementToken) revert InvalidPath();
        } else if (
            path[1] != settlementToken || path[0] == settlementToken || path[2] == settlementToken
        ) {
            revert InvalidPath();
        }

        for (uint256 i = 0; i < path.length; i++) {
            if (path[i] == address(0) || (i != 0 && path[i] == path[i - 1])) {
                revert InvalidPath();
            }
        }
    }

    function _encodePath(address[] memory path) private view returns (bytes memory encoded) {
        encoded = abi.encodePacked(path[0]);
        for (uint256 i = 1; i < path.length; i++) {
            encoded = bytes.concat(encoded, bytes3(poolFee), bytes20(path[i]));
        }
    }
}
