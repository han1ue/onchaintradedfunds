// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IEntryAdapter } from "../interfaces/IEntryAdapter.sol";
import { SafeTransferLib } from "../libraries/SafeTransferLib.sol";
import { MathEx } from "../libraries/MathEx.sol";

contract MockEntryAdapter is IEntryAdapter {
    using SafeTransferLib for address;

    error MissingRate(address tokenIn, address tokenOut);
    error MaximumInputExceeded(uint256 required, uint256 maximum);

    struct Rate {
        uint256 numerator;
        uint256 denominator;
    }

    mapping(bytes32 => Rate) public rates;

    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator)
        external
    {
        rates[_key(tokenIn, tokenOut)] = Rate(numerator, denominator);
    }

    function buyExactOutput(
        address settlementToken,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        bytes calldata
    ) external returns (uint256 amountIn) {
        Rate memory rate = rates[_key(settlementToken, tokenOut)];
        if (rate.denominator == 0) revert MissingRate(settlementToken, tokenOut);
        amountIn = MathEx.mulDivUp(amountOut, rate.numerator, rate.denominator);
        if (amountIn > maxAmountIn) revert MaximumInputExceeded(amountIn, maxAmountIn);
        settlementToken.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOut.safeTransfer(msg.sender, amountOut);
    }

    function _key(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }
}
