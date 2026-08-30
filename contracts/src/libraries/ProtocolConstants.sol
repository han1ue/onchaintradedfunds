// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ProtocolConstants {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant MAX_CONSTITUENTS = 20;
    uint16 internal constant MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS = 1_000;
    uint256 internal constant MINIMUM_SHARE_SUPPLY = 1e18;
}
