// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library FeeGrowthReference {
    // 36-decimal Taylor arithmetic, independent of the production rational approximation.
    // For rates <= 1000 bps and elapsed <= 100 years, truncation is < one WAD wei.
    function growth(uint16 rate, uint256 elapsed) internal pure returns (uint256) {
        uint256 scale = 1e36;
        uint256 r = uint256(rate) * scale / 10_000;
        uint256 power = r;
        uint256 logarithm;
        for (uint256 k = 1; k <= 60; k++) {
            logarithm += power / k;
            power = power * r / scale;
        }
        uint256 x = logarithm * elapsed / 365 days;
        uint256 term = scale;
        uint256 result = scale;
        for (uint256 k = 1; k <= 80; k++) {
            term = term * x / scale / k;
            result += term;
        }
        return result / 1e18;
    }
}

