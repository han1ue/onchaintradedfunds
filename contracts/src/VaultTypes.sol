// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct VaultInitParams {
    string name;
    string symbol;
    string initialStrategyRationale;
    address manager;
    address feeRecipient;
    address[] initialAssets;
    uint16[] initialTargetWeightsBps;
    uint256[] initialAmounts;
    uint256 initialShareSupply;
    uint16 creatorFeeBpsPerYear;
    uint16 maxNavLossBps;
    uint16 maxWeightDeviationBps;
    uint16 challengeWeightDeviationBps;
    bytes32 deploymentSalt;
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
    uint64 epochId;
    uint32 strategyVersion;
    uint256 navBefore;
    uint256 navAfter;
    uint16 batchLossBps;
    uint16 epochLossUsedBps;
    uint16 tradeCount;
}
