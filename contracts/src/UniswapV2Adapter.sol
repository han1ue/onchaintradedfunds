// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IEntryAdapter } from "./interfaces/IEntryAdapter.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract UniswapV2Adapter is ITradeAdapter, IEntryAdapter {
    using SafeTransferLib for address;

    error NotOwner();
    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidRouter(address router);
    error InvalidPath();
    error InvalidAmount();
    error Slippage(uint256 received, uint256 minimum);
    error InputMismatch(uint256 reported, uint256 observed);
    error OutputMismatch(uint256 expected, uint256 observed);

    event CallerApprovalChanged(address indexed caller, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public immutable uniswapRouter;
    mapping(address => bool) public isCallerApproved;

    constructor(address initialOwner, address uniswapRouter_) {
        if (initialOwner == address(0) || uniswapRouter_ == address(0)) revert ZeroAddress();
        if (uniswapRouter_.code.length == 0) revert InvalidRouter(uniswapRouter_);
        owner = initialOwner;
        uniswapRouter = uniswapRouter_;
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
    ) external onlyApprovedCaller returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) revert InvalidAmount();
        address[] memory path = abi.decode(data, (address[]));
        _validatePath(path, tokenIn, tokenOut);

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        tokenIn.safeApprove(uniswapRouter, 0);
        tokenIn.safeApprove(uniswapRouter, amountIn);
        uint256[] memory amounts = IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
            amountIn, minAmountOut, path, msg.sender, block.timestamp
        );
        tokenIn.safeApprove(uniswapRouter, 0);

        uint256 observedInput = inputBefore - IERC20(tokenIn).balanceOf(address(this));
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - outputBefore;
        uint256 reportedOutput = amounts[amounts.length - 1];
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        if (reportedOutput != amountOut) revert OutputMismatch(reportedOutput, amountOut);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
    }

    function buyExactOutput(
        address settlementToken,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        bytes calldata data
    ) external onlyApprovedCaller returns (uint256 amountIn) {
        if (amountOut == 0 || maxAmountIn == 0 || settlementToken == tokenOut) {
            revert InvalidAmount();
        }
        address[] memory path = abi.decode(data, (address[]));
        _validatePath(path, settlementToken, tokenOut);

        uint256 adapterInputBefore = IERC20(settlementToken).balanceOf(address(this));
        uint256 callerOutputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        settlementToken.safeTransferFrom(msg.sender, address(this), maxAmountIn);
        uint256 pulled = IERC20(settlementToken).balanceOf(address(this)) - adapterInputBefore;
        if (pulled != maxAmountIn) revert InputMismatch(maxAmountIn, pulled);

        settlementToken.safeApprove(uniswapRouter, 0);
        settlementToken.safeApprove(uniswapRouter, maxAmountIn);
        uint256[] memory amounts = IUniswapV2Router(uniswapRouter).swapTokensForExactTokens(
            amountOut, maxAmountIn, path, msg.sender, block.timestamp
        );
        settlementToken.safeApprove(uniswapRouter, 0);

        amountIn = amounts[0];
        uint256 observedOutput = IERC20(tokenOut).balanceOf(msg.sender) - callerOutputBefore;
        if (observedOutput != amountOut) revert OutputMismatch(amountOut, observedOutput);
        uint256 refund = maxAmountIn - amountIn;
        if (refund != 0) settlementToken.safeTransfer(msg.sender, refund);
        uint256 adapterInputAfter = IERC20(settlementToken).balanceOf(address(this));
        if (adapterInputAfter != adapterInputBefore) {
            revert InputMismatch(amountIn, adapterInputBefore + maxAmountIn - adapterInputAfter);
        }
    }

    function _validatePath(address[] memory path, address tokenIn, address tokenOut) private pure {
        if (
            path.length < 2 || path[0] != tokenIn || path[path.length - 1] != tokenOut
                || tokenIn == address(0) || tokenOut == address(0)
        ) {
            revert InvalidPath();
        }
        for (uint256 i = 0; i < path.length; i++) {
            if (path[i] == address(0)) revert InvalidPath();
        }
    }
}
