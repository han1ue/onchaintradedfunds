// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ITradeAdapter } from "../../src/interfaces/ITradeAdapter.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract MockTradeAdapter is ITradeAdapter {
    using SafeERC20 for IERC20;

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

    uint256 public batchCalls;

    function routeTokens(Trade[] calldata trades) external pure returns (address[] memory tokens) {
        tokens = new address[](trades.length * 2);
        uint256 count;
        for (uint256 i; i < trades.length; ++i) {
            address[2] memory pair = [trades[i].tokenIn, trades[i].tokenOut];
            for (uint256 j; j < 2; ++j) {
                bool found;
                for (uint256 k; k < count; ++k) {
                    if (tokens[k] == pair[j]) found = true;
                }
                if (!found) tokens[count++] = pair[j];
            }
        }
        assembly ("memory-safe") { mstore(tokens, count) }
    }

    function executeBatch(
        Trade[] calldata trades,
        address[] calldata tokens,
        uint256[] calldata funding,
        uint256
    ) external returns (uint256[] memory returned) {
        if (msg.sender != entryExitRouter) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (failNextSwap) revert MockSwapFailed();
        if (reentrantCall.length != 0) {
            (bool success,) = entryExitRouter.call(reentrantCall);
            if (!success) revert ReentrantCallFailed();
        }

        ++batchCalls;
        returned = funding;
        for (uint256 i; i < trades.length; ++i) {
            Trade calldata trade = trades[i];
            uint256 input;
            uint256 output;
            for (uint256 j; j < tokens.length; ++j) {
                if (tokens[j] == trade.tokenIn) input = j;
                if (tokens[j] == trade.tokenOut) output = j;
            }
            uint256 amount = trade.amountIn == type(uint256).max ? returned[input] : trade.amountIn;
            Rate memory rate = rates[_key(trade.tokenIn, trade.tokenOut)];
            if (rate.denominator == 0) revert MissingRate(trade.tokenIn, trade.tokenOut);
            uint256 received = Math.mulDiv(amount, rate.numerator, rate.denominator);
            if (received < trade.minAmountOut) revert Slippage(received, trade.minAmountOut);
            returned[input] -= amount;
            if (returnInput) IERC20(trade.tokenIn).safeTransfer(entryExitRouter, amount);
            else IERC20(trade.tokenIn).safeTransfer(address(0xdead), amount);
            returned[output] += received;
        }
        for (uint256 i; i < tokens.length; ++i) {
            uint256 delivered = returned[i] > outputShortfall ? returned[i] - outputShortfall : 0;
            if (delivered != 0) IERC20(tokens[i]).safeTransfer(entryExitRouter, delivered);
            returned[i] += reportedOutputBonus;
        }
    }

    function _key(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }
}
