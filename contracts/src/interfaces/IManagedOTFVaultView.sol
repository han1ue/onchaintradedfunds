// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Canonical read surface for a fixed-formation Managed OTF vault.
interface IManagedOTFVaultView {
    function assets() external view returns (address[] memory);
    function factory() external view returns (address);
    function creator() external view returns (address);
    function expenseBeneficiary() external view returns (address);
    function feeCollector() external view returns (address);
    function entryExitRouter() external view returns (address);
    function annualCreatorExpenseRatioBps() external view returns (uint16);
    function formationOtfWeightBps() external view returns (uint16);
    function formationSnapshotTime() external view returns (uint64);
    function formationCalculationVersion() external view returns (uint32);
    function formationSnapshotDigest() external view returns (bytes32);
    function relativeQuantity(address asset) external view returns (uint256);
    function accountedBalance(address asset) external view returns (uint256);
    function accountedBalances() external view returns (uint256[] memory);
    function backingIsSound() external view returns (bool);
    function shutdown() external view returns (bool);
    function shutdownAt() external view returns (uint64);
    function lastFeeCheckpointTimestamp() external view returns (uint64);
    function pendingExpenseFeeShares() external view returns (uint256);
    function feeShareRemainderWad() external view returns (uint256);
    function protocolFeeSplitRemainderBps() external view returns (uint16);
    function previewExpenseFees()
        external
        view
        returns (
            uint256 totalFeeShares,
            uint256 creatorShares,
            uint256 protocolShares,
            uint16 effectiveProtocolShareBps
        );
    function previewMint(uint256 shares) external view returns (uint256[] memory amountsIn);
    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        view
        returns (uint256 shares, uint256[] memory amountsIn);
    function previewRedeem(uint256 shares) external view returns (uint256[] memory amountsOut);
}
