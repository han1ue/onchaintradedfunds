// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Exact interface required from Uniswap SwapRouter02's V3 integration.
/// @dev This is deliberately the four-field tuple, not legacy ISwapRouter's deadline tuple.
interface IUniswapV3SwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function factory() external view returns (address);

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
