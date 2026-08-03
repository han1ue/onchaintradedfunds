// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEntryAdapter {
    function buyExactOutput(
        address settlementToken,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        bytes calldata data
    ) external returns (uint256 amountIn);
}
