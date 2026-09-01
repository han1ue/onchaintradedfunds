// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Minimal concentrated-liquidity math used by the fixed OTF launch ranges.
library V4LiquidityMath {
    uint256 internal constant Q96 = 1 << 96;

    function liquidityForAmounts(
        uint160 sqrtPriceX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        (uint160 sqrtA, uint160 sqrtB) = sqrtRatioAX96 < sqrtRatioBX96
            ? (sqrtRatioAX96, sqrtRatioBX96)
            : (sqrtRatioBX96, sqrtRatioAX96);
        uint256 rawLiquidity;
        if (sqrtPriceX96 <= sqrtA) {
            rawLiquidity = liquidityForAmount0(sqrtA, sqrtB, amount0);
        } else if (sqrtPriceX96 < sqrtB) {
            uint256 liquidity0 = liquidityForAmount0(sqrtPriceX96, sqrtB, amount0);
            uint256 liquidity1 = liquidityForAmount1(sqrtA, sqrtPriceX96, amount1);
            rawLiquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            rawLiquidity = liquidityForAmount1(sqrtA, sqrtB, amount1);
        }
        if (rawLiquidity > type(uint128).max) revert("LIQUIDITY_OVERFLOW");
        // The explicit bound above makes this conversion exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        liquidity = uint128(rawLiquidity);
    }

    function liquidityForAmount0(uint160 sqrtA, uint160 sqrtB, uint256 amount0)
        internal
        pure
        returns (uint256)
    {
        uint256 intermediate = Math.mulDiv(uint256(sqrtA), uint256(sqrtB), Q96);
        return Math.mulDiv(amount0, intermediate, uint256(sqrtB) - uint256(sqrtA));
    }

    function liquidityForAmount1(uint160 sqrtA, uint160 sqrtB, uint256 amount1)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(amount1, Q96, uint256(sqrtB) - uint256(sqrtA));
    }

    function amountsForLiquidity(
        uint160 sqrtPriceX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtA, uint160 sqrtB) = sqrtRatioAX96 < sqrtRatioBX96
            ? (sqrtRatioAX96, sqrtRatioBX96)
            : (sqrtRatioBX96, sqrtRatioAX96);
        if (sqrtPriceX96 <= sqrtA) {
            amount0 = amount0ForLiquidity(sqrtA, sqrtB, liquidity);
        } else if (sqrtPriceX96 < sqrtB) {
            amount0 = amount0ForLiquidity(sqrtPriceX96, sqrtB, liquidity);
            amount1 = amount1ForLiquidity(sqrtA, sqrtPriceX96, liquidity);
        } else {
            amount1 = amount1ForLiquidity(sqrtA, sqrtB, liquidity);
        }
    }

    function amount0ForLiquidity(uint160 sqrtA, uint160 sqrtB, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(
            uint256(liquidity) << 96, uint256(sqrtB) - uint256(sqrtA), uint256(sqrtB)
        ) / uint256(sqrtA);
    }

    function amount1ForLiquidity(uint160 sqrtA, uint160 sqrtB, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(uint256(liquidity), uint256(sqrtB) - uint256(sqrtA), Q96);
    }
}
