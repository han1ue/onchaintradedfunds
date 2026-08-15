// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IEntryAdapter } from "./interfaces/IEntryAdapter.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

/// @notice Adapter for firm 0x Swap API v2 quotes using the AllowanceHolder flow.
/// @dev Quote requests must set this contract as both `taker` and `recipient`. The quote's
///      `transaction.to` and allowance spender must match the immutable configured targets.
contract ZeroXSwapAdapter is ITradeAdapter, IEntryAdapter {
    using SafeTransferLib for address;

    error NotOwner();
    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidAmount();
    error InvalidSettlementToken(address token);
    error NoInputSpent();
    error InputMismatch(uint256 expected, uint256 observed);
    error OutputMismatch(uint256 expected, uint256 observed);
    error Slippage(uint256 received, uint256 minimum);
    error ResidualBalance(address token, uint256 balance);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error Reentrancy();

    event CallerApprovalChanged(address indexed caller, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event TokenRecovered(address indexed token, address indexed recipient, uint256 amount);
    event SwapExecuted(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bool exactOutput
    );

    address public owner;
    address public immutable swapTarget;
    address public immutable allowanceTarget;
    address public immutable settlementToken;
    mapping(address => bool) public isCallerApproved;

    bool private _entered;

    constructor(
        address initialOwner,
        address swapTarget_,
        address allowanceTarget_,
        address settlementToken_
    ) {
        if (initialOwner == address(0) || settlementToken_ == address(0)) {
            revert ZeroAddress();
        }
        if (swapTarget_ == address(0) || swapTarget_.code.length == 0) {
            revert InvalidDependency(swapTarget_);
        }
        if (allowanceTarget_ == address(0) || allowanceTarget_.code.length == 0) {
            revert InvalidDependency(allowanceTarget_);
        }
        if (settlementToken_.code.length == 0) revert InvalidDependency(settlementToken_);

        owner = initialOwner;
        swapTarget = swapTarget_;
        allowanceTarget = allowanceTarget_;
        settlementToken = settlementToken_;
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

    /// @notice Recovers tokens sent directly to the non-custodial adapter.
    /// @dev Successful swaps require clean starting balances, so recovery also restores liveness
    ///      after an unsolicited token transfer.
    function recoverToken(address token, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (token == address(0) || recipient == address(0)) revert ZeroAddress();
        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert InvalidAmount();
        _pushExact(token, recipient, amount);
        emit TokenRecovered(token, recipient, amount);
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata adapterData
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut)
        {
            revert InvalidAmount();
        }

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(address(this));
        if (inputBefore != amountIn) revert ResidualBalance(tokenIn, inputBefore);
        if (outputBefore != 0) revert ResidualBalance(tokenOut, outputBefore);

        tokenIn.safeApprove(allowanceTarget, 0);
        tokenIn.safeApprove(allowanceTarget, amountIn);
        _callSwapTarget(adapterData);
        tokenIn.safeApprove(allowanceTarget, 0);

        uint256 inputAfter = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputAfter = IERC20(tokenOut).balanceOf(address(this));
        uint256 observedInput = inputBefore >= inputAfter ? inputBefore - inputAfter : 0;
        amountOut = outputAfter >= outputBefore ? outputAfter - outputBefore : 0;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);

        _pushExact(tokenOut, msg.sender, amountOut);
        _requireNoBalance(tokenIn);
        _requireNoBalance(tokenOut);
        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, false);
    }

    function buyExactOutput(
        address settlementToken_,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        bytes calldata adapterData
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountIn) {
        if (settlementToken_ != settlementToken) {
            revert InvalidSettlementToken(settlementToken_);
        }
        if (
            amountOut == 0 || maxAmountIn == 0 || tokenOut == address(0)
                || tokenOut == settlementToken_
        ) revert InvalidAmount();

        uint256 inputBefore = IERC20(settlementToken_).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(address(this));
        if (inputBefore != 0) revert ResidualBalance(settlementToken_, inputBefore);
        if (outputBefore != 0) revert ResidualBalance(tokenOut, outputBefore);

        _pullExact(settlementToken_, msg.sender, address(this), maxAmountIn);
        settlementToken_.safeApprove(allowanceTarget, 0);
        settlementToken_.safeApprove(allowanceTarget, maxAmountIn);
        _callSwapTarget(adapterData);
        settlementToken_.safeApprove(allowanceTarget, 0);

        uint256 inputAfterSwap = IERC20(settlementToken_).balanceOf(address(this));
        uint256 outputAfterSwap = IERC20(tokenOut).balanceOf(address(this));
        amountIn = maxAmountIn >= inputAfterSwap ? maxAmountIn - inputAfterSwap : maxAmountIn + 1;
        uint256 observedOutput =
            outputAfterSwap >= outputBefore ? outputAfterSwap - outputBefore : 0;
        if (amountIn > maxAmountIn) revert InputMismatch(maxAmountIn, amountIn);
        if (amountIn == 0) revert NoInputSpent();
        if (observedOutput != amountOut) revert OutputMismatch(amountOut, observedOutput);

        _pushExact(tokenOut, msg.sender, amountOut);
        uint256 refund = maxAmountIn - amountIn;
        if (refund != 0) _pushExact(settlementToken_, msg.sender, refund);
        _requireNoBalance(settlementToken_);
        _requireNoBalance(tokenOut);
        emit SwapExecuted(msg.sender, settlementToken_, tokenOut, amountIn, amountOut, true);
    }

    function _callSwapTarget(bytes calldata adapterData) private {
        (bool success, bytes memory returnData) = swapTarget.call(adapterData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
    }

    function _pullExact(address token, address from, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(from);
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(from),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
    }

    function _pushExact(address token, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransfer(to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(address(this)),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
    }

    function _verifyTransfer(
        address token,
        uint256 expected,
        uint256 senderBefore,
        uint256 senderAfter,
        uint256 receiverBefore,
        uint256 receiverAfter
    ) private pure {
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != expected || receiverDelta != expected) {
            revert TokenTransferMismatch(token, expected, senderDelta, receiverDelta);
        }
    }

    function _requireNoBalance(address token) private view {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) revert ResidualBalance(token, balance);
    }
}
