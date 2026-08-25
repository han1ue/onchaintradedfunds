// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    PricingSource,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord
} from "../VaultTypes.sol";

/// @notice Canonical read ABI routed through a ManagedOTFVault address.
interface IManagedOTFVaultView {
    function assets() external view returns (address[] memory);
    function factory() external view returns (address);
    function manager() external view returns (address);
    function feeRecipient() external view returns (address);
    function feeCollector() external view returns (address);
    function assetRegistry() external view returns (address);
    function rebalanceExecutor() external view returns (address);
    function creatorFeeBpsPerYear() external view returns (uint16);
    function protocolFeeShareBps() external view returns (uint16);
    function maxNavLossBps() external view returns (uint16);
    function maxWeightDeviationBps() external view returns (uint16);
    function challengeWeightDeviationBps() external view returns (uint16);
    function lastFeeAccrualTimestamp() external view returns (uint64);
    function lastCompletedStrategyTimestamp() external view returns (uint64);
    function strategicRebalanceStartedAt() external view returns (uint64);
    function pendingStrategyProposedAt() external view returns (uint64);
    function pendingStrategyActivationTime() external view returns (uint64);
    function rebalanceCount() external view returns (uint256);
    function escrowedManagerFeeShares() external view returns (uint256);
    function forfeitedManagerFeeShares() external view returns (uint256);
    function strategicRebalanceActive() external view returns (bool);
    function strategyProposalPending() external view returns (bool);
    function challengeActive() external view returns (bool);
    function challengeCaller() external view returns (address);
    function challengeStartedAt() external view returns (uint64);
    function challengeDeadline() external view returns (uint64);
    function targetWeightBps(address asset) external view returns (uint16);
    function authorizedExecutor(address executor) external view returns (bool);
    function challengeRewardShares(address account) external view returns (uint256);
    function sunset() external view returns (bool);
    function sunsetAt() external view returns (uint64);
    function tradeExecutionCount() external view returns (uint256);
    function pendingManager() external view returns (address);
    function strategyVersionCount() external view returns (uint256);
    function getStrategyVersion(uint256 index) external view returns (StrategyVersion memory);
    function getStrategyTargets(uint256 index)
        external view returns (address[] memory tokens, uint16[] memory weights);
    function pendingStrategyRationale() external view returns (string memory);
    function nextStrategyRationale() external view returns (string memory);
    function getConstituents()
        external view returns (address[] memory tokens, uint256[] memory weights);
    function totalConstituents() external view returns (uint256);
    function getWeight(address token) external view returns (uint256);
    function isConstituent(address token) external view returns (bool);
    function getReserve(address token) external view returns (uint256);
    function totalBasketValue() external view returns (uint256);
    function assetMarketRegistry() external view returns (address);
    function marketIdForAsset(address asset) external view returns (bytes32);
    function priceFeedForAsset(address asset) external view returns (address);
    function pricingConfigForAsset(address asset)
        external
        view
        returns (
            bool configured,
            PricingSource source,
            address quoteToken,
            address primarySource,
            address secondarySource,
            address normalizedPriceFeed,
            uint32 primaryMaxStaleness,
            uint32 secondaryMaxStaleness
        );
    function maxStalenessForAsset(address asset) external view returns (uint32);
    function pricingSourceForAsset(address asset) external view returns (PricingSource);
    function totalAssetsValue() external view returns (uint256);
    function navPerShare() external view returns (uint256);
    function currentWeightsBps() external view returns (uint16[] memory);
    function currentWeight(address token) external view returns (uint256);
    function getWeightBands(address token)
        external
        view
        returns (uint256 challengeLower, uint256 challengeUpper, uint256 completionLower, uint256 completionUpper);
    function isWithinTargetBands() external view returns (bool);
    function isWithinChallengeBands() external view returns (bool);
    function canProposeStrategy() external view returns (bool);
    function challengeTimeRemaining() external view returns (uint256);
    function nextStrategyChangeTime() external view returns (uint256);
    function feeState() external view returns (uint8);
    function authorizedExecutors() external view returns (address[] memory);
    function previewContribute(uint256[] calldata amounts) external view returns (uint256);
    function previewWithdraw(uint256 lpAmount) external view returns (uint256[] memory);
    function previewMint(uint256 shares) external view returns (uint256[] memory);
    function previewRedeem(uint256 shares) external view returns (uint256[] memory);
    function recentRebalanceCount() external view returns (uint256);
    function recentRebalanceRecord(uint256 index) external view returns (RebalanceRecord memory);
    function navLossBudgetState()
        external
        view
        returns (uint64 recoveryAt, uint16 usedLossBps, uint16 maximumLossBps);
    function recentTradeExecutionCount() external view returns (uint256);
    function recentTradeExecutionRecord(uint256 index)
        external
        view
        returns (TradeExecutionRecord memory);
}
