// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ProtocolConstants {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant MAX_CONSTITUENTS = 20;
    uint16 internal constant MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS = 1_000;

    /// @dev One formation basket initially corresponds to one 18-decimal vault share.
    uint256 internal constant FORMATION_SHARE_UNIT = 1e18;
    uint32 internal constant FORMATION_CALCULATION_VERSION = 1;
    uint8 internal constant MAX_CONSTITUENT_DECIMALS = 36;
}
