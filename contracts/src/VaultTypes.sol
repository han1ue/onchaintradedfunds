// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Creator-selected immutable OTF configuration.
/// @dev Basket units are raw token quantities required for exactly 1e18 vault shares.
struct VaultCreationParams {
    string name;
    string symbol;
    string fundThesis;
    address expenseBeneficiary;
    uint16 annualCreatorExpenseRatioBps;
    uint16 mintFeeBps;
    uint16 redeemFeeBps;
    address[] constituents;
    uint256[] bootstrapBasketUnitsPerOTF;
}
