// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITradeAdapter } from "../../src/interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "../../src/libraries/SafeTransferLib.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract MockTradeAdapter is ITradeAdapter {
    using SafeTransferLib for address;

    error UnauthorizedCaller(address caller);
    error MissingRate(address tokenIn, address tokenOut);
    error MockSwapFailed();
    error ReentrantCallFailed();
    error Slippage(uint256 amountOut, uint256 minimum);

    struct Rate {
        uint256 numerator;
        uint256 denominator;
    }

    address public immutable entryExitRouter;
    mapping(bytes32 => Rate) public rates;
    bool public failNextSwap;
    bool public returnInput;
    uint256 public reportedOutputBonus;
    uint256 public outputShortfall;
    bytes public reentrantCall;

    constructor(address entryExitRouter_) {
        entryExitRouter = entryExitRouter_;
    }

    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator)
        external
    {
        rates[_key(tokenIn, tokenOut)] = Rate({ numerator: numerator, denominator: denominator });
    }

    function setBehavior(
        bool failNextSwap_,
        bool returnInput_,
        uint256 reportedOutputBonus_,
        uint256 outputShortfall_
    ) external {
        failNextSwap = failNextSwap_;
        returnInput = returnInput_;
        reportedOutputBonus = reportedOutputBonus_;
        outputShortfall = outputShortfall_;
    }

    function setReentrantCall(bytes calldata data) external {
        reentrantCall = data;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata
    ) external returns (uint256 amountOut) {
        if (msg.sender != entryExitRouter) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (failNextSwap) revert MockSwapFailed();
        if (reentrantCall.length != 0) {
            (bool success,) = entryExitRouter.call(reentrantCall);
            if (!success) revert ReentrantCallFailed();
        }

        Rate memory rate = rates[_key(tokenIn, tokenOut)];
        if (rate.denominator == 0) revert MissingRate(tokenIn, tokenOut);
        amountOut = Math.mulDiv(amountIn, rate.numerator, rate.denominator);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);

        if (returnInput) tokenIn.safeTransfer(entryExitRouter, amountIn);
        else tokenIn.safeTransfer(address(0xdead), amountIn);

        uint256 delivered = amountOut > outputShortfall ? amountOut - outputShortfall : 0;
        if (delivered != 0) tokenOut.safeTransfer(entryExitRouter, delivered);
        return amountOut + reportedOutputBonus;
    }

    function _key(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }
}
