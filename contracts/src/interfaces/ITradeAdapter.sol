// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Narrow execution boundary for router-approved token swap adapters.
interface ITradeAdapter {
    struct Trade {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes data;
    }

    function entryExitRouter() external view returns (address);

    /// @notice Complete, deduplicated ERC20 currency set, including intermediate currencies.
    function routeTokens(Trade[] calldata trades) external view returns (address[] memory);

    /// @notice Execute ordered trades with the supplied, already transferred funding.
    /// @dev Returns amounts sent back to the entry router in `tokens` order. All amounts
    ///      exclude pre-existing balances. MAX_UINT spends the current operation balance.
    function executeBatch(
        Trade[] calldata trades,
        address[] calldata tokens,
        uint256[] calldata funding,
        uint256 deadline
    ) external returns (uint256[] memory returned);
}
