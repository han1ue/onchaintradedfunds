// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

library V4PriceMath {
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant Q192 = 1 << 192;
    uint256 internal constant WAD = 1e18;

    /// @notice WETH per OTF scaled by 1e18. Both canonical currencies are validated as 18 decimals.
    function otfPriceWethWad(uint160 sqrtPriceX96, bool otfIsCurrency0)
        internal
        pure
        returns (uint256)
    {
        if (sqrtPriceX96 == 0) return 0;
        if (otfIsCurrency0) {
            return Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96) * WAD, Q192);
        }
        uint256 inverseTimesSqrt = Math.mulDiv(Q96, Q96 * WAD, sqrtPriceX96);
        return inverseTimesSqrt / sqrtPriceX96;
    }
}
