// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Authority-attested market data used to form an OTF without live oracle reads.
/// @dev The arrays are ordered and their exact order is covered by the EIP-712 signature.
struct FormationSnapshot {
    uint256 chainId;
    address factory;
    address creator;
    address[] constituents;
    uint8[] tokenDecimals;
    uint256[] marketCapsUsdWad;
    uint256[] unitPricesUsdWad;
    uint64 snapshotTime;
    uint64 expiry;
    uint32 calculationVersion;
    uint256 nonce;
}

/// @notice Creator-selected metadata and the one retained fund expense ratio.
/// @dev Neither portfolio weights nor constituent amounts are creator supplied.
struct VaultCreationParams {
    string name;
    string symbol;
    address expenseBeneficiary;
    uint16 annualCreatorExpenseRatioBps;
}

/// @dev Fully verified initialization data passed by the factory to a vault clone.
struct VaultInitParams {
    string name;
    string symbol;
    address creator;
    address expenseBeneficiary;
    address entryExitRouter;
    address feeCollector;
    address[] constituents;
    uint256[] relativeQuantities;
    uint16 annualCreatorExpenseRatioBps;
    uint16 formationOtfWeightBps;
    uint64 formationSnapshotTime;
    uint32 formationCalculationVersion;
    bytes32 formationSnapshotDigest;
}
