// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITradeAdapter } from "../interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "../libraries/SafeTransferLib.sol";
import { MathEx } from "../libraries/MathEx.sol";

contract MockTradeAdapter is ITradeAdapter {
    using SafeTransferLib for address;

    error MissingRate(address tokenIn, address tokenOut);
    error MockSwapFailed();
    error Slippage(uint256 amountOut, uint256 minAmountOut);

    event RateSet(address indexed tokenIn, address indexed tokenOut, uint256 numerator, uint256 denominator);

    struct Rate {
        uint256 numerator;
        uint256 denominator;
    }

    mapping(bytes32 => Rate) public rates;
    bool public failNextSwap;

    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator) external {
        rates[_key(tokenIn, tokenOut)] = Rate({ numerator: numerator, denominator: denominator });
        emit RateSet(tokenIn, tokenOut, numerator, denominator);
    }

    function setFailNextSwap(bool fail) external {
        failNextSwap = fail;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata
    ) external returns (uint256 amountOut) {
        if (failNextSwap) {
            failNextSwap = false;
            revert MockSwapFailed();
        }

        Rate memory rate = rates[_key(tokenIn, tokenOut)];
        if (rate.denominator == 0) revert MissingRate(tokenIn, tokenOut);

        amountOut = MathEx.mulDiv(amountIn, rate.numerator, rate.denominator);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);

        tokenOut.safeTransfer(msg.sender, amountOut);
    }

    function _key(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }
}

