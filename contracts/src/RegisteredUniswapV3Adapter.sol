// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { IUniswapV3SwapRouter } from "./interfaces/IUniswapV3SwapRouter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Generic Uniswap V3 adapter for explicit fee-bearing paths.
/// @dev Callers own endpoint policy. Execution paths are independent from every oracle pool and
///      pricing registry.
contract RegisteredUniswapV3Adapter is ITradeAdapter, Ownable2Step {
    using SafeTransferLib for address;

    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidAmount();
    error InvalidPath();
    error Slippage(uint256 received, uint256 minimum);
    error InputMismatch(uint256 expected, uint256 observed);
    error OutputMismatch(uint256 reported, uint256 observed);
    error Reentrancy();

    event CallerApprovalChanged(address indexed caller, bool approved);

    address public immutable uniswapRouter;
    mapping(address => bool) public isCallerApproved;
    bool private _entered;

    constructor(address initialOwner, address uniswapRouter_) Ownable(initialOwner) {
        if (uniswapRouter_.code.length == 0) revert InvalidDependency(uniswapRouter_);
        uniswapRouter = uniswapRouter_;
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

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) revert InvalidAmount();
        _validatePath(data, tokenIn, tokenOut);

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        tokenIn.safeApprove(uniswapRouter, 0);
        tokenIn.safeApprove(uniswapRouter, amountIn);
        uint256 reportedOutput = IUniswapV3SwapRouter(uniswapRouter)
            .exactInput(
                IUniswapV3SwapRouter.ExactInputParams({
                path: data,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            })
            );
        tokenIn.safeApprove(uniswapRouter, 0);

        uint256 observedInput = inputBefore - IERC20(tokenIn).balanceOf(address(this));
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - outputBefore;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        if (reportedOutput != amountOut) revert OutputMismatch(reportedOutput, amountOut);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
    }

    function _validatePath(bytes calldata path, address tokenIn, address tokenOut) private pure {
        uint256 length = path.length;
        if (length < 43 || (length - 20) % 23 != 0) revert InvalidPath();
        uint256 hops = (length - 20) / 23;
        if (_addressAt(path, 0) != tokenIn || _addressAt(path, hops * 23) != tokenOut) {
            revert InvalidPath();
        }

        for (uint256 i = 0; i <= hops; i++) {
            address token = _addressAt(path, i * 23);
            if (token == address(0)) revert InvalidPath();
            if (i == hops) continue;
            address nextToken = _addressAt(path, (i + 1) * 23);
            if (token == nextToken || _feeAt(path, i * 23 + 20) == 0) revert InvalidPath();
        }
    }

    function _addressAt(bytes calldata path, uint256 offset) private pure returns (address token) {
        assembly {
            token := shr(96, calldataload(add(path.offset, offset)))
        }
    }

    function _feeAt(bytes calldata path, uint256 offset) private pure returns (uint24 fee) {
        assembly {
            fee := shr(232, calldataload(add(path.offset, offset)))
        }
    }
}
