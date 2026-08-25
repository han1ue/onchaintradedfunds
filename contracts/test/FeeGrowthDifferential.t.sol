// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { TestBase } from "./TestBase.sol";

contract FeeGrowthDifferentialTest is TestBase {
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    uint256 private constant REFERENCE_SCALE = 1e36;

    PortfolioCalculator private calculator;

    function setUp() public {
        calculator = new PortfolioCalculator();
    }

    /// @dev At half a year, exact fee growth is sqrt(BPS / (BPS - feeBps)). The expected value
    ///      below uses a 36-decimal integer-rational radicand and Babylonian square root, sharing
    ///      neither the WAD logarithm nor exponential approximation used by production code.
    function testHalfYearFeeGrowthMatchesIndependentHighPrecisionSquareRoot() public view {
        uint16[5] memory feeRates = [uint16(1), 100, 777, 1_500, 2_000];
        uint256[4] memory supplies = [uint256(1e18), 100e18, 12_345e18, 1_000_000e18];

        for (uint256 i = 0; i < feeRates.length; i++) {
            for (uint256 j = 0; j < supplies.length; j++) {
                _assertHalfYearDifferential(supplies[j], feeRates[i]);
            }
        }
    }

    function testFuzzHalfYearFeeGrowthMatchesIndependentHighPrecisionSquareRoot(
        uint128 rawSupply,
        uint16 rawFeeBps
    ) public view {
        uint256 supply = bound(rawSupply, 1, 1e30);
        uint16 feeBps = uint16(bound(rawFeeBps, 1, 2_000));
        _assertHalfYearDifferential(supply, feeBps);
    }

    function _assertHalfYearDifferential(uint256 supply, uint16 feeBps) private view {
        (uint256 actualFeeShares, uint256 remainderAfterWad) =
            calculator.feeSharesAfterElapsed(supply, 0, feeBps, YEAR / 2);
        uint256 expectedFeeShares = _referenceHalfYearFeeShares(supply, feeBps);

        // This allows four 1e-18 growth units plus four raw share-wei for integer
        // boundaries, while the reference itself carries 36 decimal places.
        uint256 maximumDelta = supply / 250_000_000_000_000_000 + 4;
        assertApproxEqAbs(actualFeeShares, expectedFeeShares, maximumDelta);
        assertLt(remainderAfterWad, 1e18);
    }

    function _referenceHalfYearFeeShares(uint256 supply, uint16 feeBps)
        private
        pure
        returns (uint256)
    {
        uint256 denominator = BPS - feeBps;
        uint256 radicand = BPS * REFERENCE_SCALE * REFERENCE_SCALE / denominator;
        uint256 growth = _babylonianSqrt(radicand);
        uint256 supplyAfter = supply * growth / REFERENCE_SCALE;
        return supplyAfter - supply;
    }

    function _babylonianSqrt(uint256 x) private pure returns (uint256 result) {
        if (x == 0) return 0;
        result = x;
        uint256 candidate = (x + 1) / 2;
        while (candidate < result) {
            result = candidate;
            candidate = (x / candidate + candidate) / 2;
        }
    }
}



