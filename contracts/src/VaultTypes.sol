// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum PricingSource {
    Chainlink,
    ChainlinkComposed,
    UniswapV3Twap,
    ChainlinkRobinhood
}

/// @notice User-supplied pricing configuration pinned when an asset first enters an OTF.
/// @dev `primarySource` is the direct feed, asset/quote feed, or V3 asset/quote pool.
///      `quoteToken` is zero for direct pricing and explicit for composed and V3 routes.
///      The resolver loads the quote/USD leg and all of its rules from the admin registry.
struct AssetPricingConfig {
    PricingSource source;
    address quoteToken;
    address primarySource;
    uint32 primaryMaxStaleness;
}

/// @notice Canonical vault record for a constituent's pinned pricing identity.
struct PinnedAssetPricing {
    PricingSource source;
    address quoteToken;
    address primarySource;
    address normalizedPriceFeed;
    uint32 primaryMaxStaleness;
}

struct VaultInitParams {
    string name;
    string symbol;
    string initialStrategyRationale;
    address manager;
    address feeRecipient;
    address[] initialAssets;
    AssetPricingConfig[] initialPricingConfigs;
    uint16[] initialTargetWeightsBps;
    uint256[] initialAmounts;
    uint256 initialShareSupply;
    uint16 managerFeeBpsPerYear;
    uint16 maxNavLossBps;
    uint16 maxWeightDeviationBps;
    uint16 challengeWeightDeviationBps;
}

struct TradeInstruction {
    address adapter;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes adapterData;
}

struct StrategyVersion {
    uint64 proposedAt;
    uint64 activatedAt;
    uint64 completedAt;
    address author;
    string rationale;
}

struct RebalanceRecord {
    uint64 timestamp;
    address manager;
    uint256 navPerShareBefore;
    uint256 navPerShareAfter;
    uint16 turnoverBps;
    uint32 executionLossBps;
    uint32 strategyVersion;
}

struct TradeExecutionRecord {
    uint64 timestamp;
    address executor;
    uint32 strategyVersion;
    uint256 navBefore;
    uint256 navAfter;
    uint16 batchLossBps;
    uint16 navLossBudgetUsedBps;
    uint16 tradeCount;
}
