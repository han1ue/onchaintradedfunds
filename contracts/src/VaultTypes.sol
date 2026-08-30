// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Creator-selected immutable OTF configuration.
/// @dev Basket units are raw token quantities required for exactly 1e18 vault shares.
struct VaultCreationParams {
    string name;
    string symbol;
    address expenseBeneficiary;
    uint16 annualCreatorExpenseRatioBps;
    address[] constituents;
    uint256[] bootstrapBasketUnitsPerOTF;
}

/// @dev Initialization data passed by the factory to a vault clone.
struct VaultInitParams {
    string name;
    string symbol;
    address creator;
    address expenseBeneficiary;
    address entryExitRouter;
    address feeCollector;
    address[] constituents;
    uint256[] bootstrapBasketUnitsPerOTF;
    uint16 annualCreatorExpenseRatioBps;
}
