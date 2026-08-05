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
    uint16 maxTurnoverBps;
    uint16 maxNavLossBps;
    uint16 maxWeightDeviationBps;
    uint16 challengeWeightDeviationBps;
    uint16 maxSingleAssetWeightBps;
    uint16 minNonZeroAssetWeightBps;
    uint8 maxAssetCount;
    uint32 maxOracleStaleness;
    uint32 challengeGracePeriod;
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
    uint256 navBefore;
    uint256 navAfter;
    uint16 turnoverBps;
    uint32 strategyVersion;
}
