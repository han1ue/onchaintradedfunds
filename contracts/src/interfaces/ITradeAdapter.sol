// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Narrow execution boundary for router-approved token swap adapters.
interface ITradeAdapter {
    function entryExitRouter() external view returns (address);

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external returns (uint256 amountOut);
}
