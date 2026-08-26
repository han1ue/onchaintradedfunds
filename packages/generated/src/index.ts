export const managedOtfVaultAbi = [
  {
    "inputs": [
      {
        "internalType": "contract PortfolioCalculator",
        "name": "portfolioCalculator_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "strategyModule_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "viewModule_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyInitialized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "required",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maximum",
        "type": "uint256"
      }
    ],
    "name": "AmountTooHigh",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      }
    ],
    "name": "AmountTooLow",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "deviationBefore",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deviationAfter",
        "type": "uint256"
      }
    ],
    "name": "AssetMovedAwayFromTarget",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "AssetNotContract",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "AssetPricingAlreadyPinned",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "senderDelta",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "receiverDelta",
        "type": "uint256"
      }
    ],
    "name": "AssetTransferMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "weightBps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      }
    ],
    "name": "AssetWeightTooLow",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenIn",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "tokenOut",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      }
    ],
    "name": "BadTrade",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ChallengeAlreadyActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ChallengeNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "DepositsPausedForRetiringAsset",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DirectStrategyCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "DuplicateConstituent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ERC20AlreadyInitialized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "allowance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "needed",
        "type": "uint256"
      }
    ],
    "name": "ERC20InsufficientAllowance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "needed",
        "type": "uint256"
      }
    ],
    "name": "ERC20InsufficientBalance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidSender",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "currentAllowance",
        "type": "uint256"
      }
    ],
    "name": "ERC20NonZeroAllowance",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyPortfolio",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "executor",
        "type": "address"
      }
    ],
    "name": "ExecutorAlreadyAuthorized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExecutorLimitReached",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "executor",
        "type": "address"
      }
    ],
    "name": "ExecutorNotAuthorized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint80",
        "name": "roundId",
        "type": "uint80"
      },
      {
        "internalType": "uint80",
        "name": "answeredInRound",
        "type": "uint80"
      }
    ],
    "name": "IncompleteOracleRound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "InitialAmountZero",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "InitialBalanceMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "supplied",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      }
    ],
    "name": "InitialShareSupplyTooSmall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "InsufficientAmount",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "InsufficientShares",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidArrayLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "int256",
        "name": "answer",
        "type": "int256"
      }
    ],
    "name": "InvalidOraclePrice",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "updatedAt",
        "type": "uint256"
      }
    ],
    "name": "InvalidOracleTimestamp",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "InvalidRecordIndex",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "InvalidRoleAddress",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "completionDeviationBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "challengeDeviationBps",
        "type": "uint16"
      }
    ],
    "name": "InvalidWeightBands",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "sum",
        "type": "uint256"
      }
    ],
    "name": "InvalidWeightSum",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "sum",
        "type": "uint256"
      }
    ],
    "name": "InvalidWeights",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokensLength",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amountsLength",
        "type": "uint256"
      }
    ],
    "name": "LengthMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "supplied",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "maximum",
        "type": "uint16"
      }
    ],
    "name": "ManagerFeeTooHigh",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "usedLossBps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "batchLossBps",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "maximumLossBps",
        "type": "uint16"
      }
    ],
    "name": "NavLossBudgetExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "navBefore",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "navAfter",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "maximumLossBps",
        "type": "uint16"
      }
    ],
    "name": "NavLossTooHigh",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoChallengeBreach",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoPendingStrategy",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "supplied",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "required",
        "type": "uint256"
      }
    ],
    "name": "NonProportionalContribution",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "NotConstituent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotInitialized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotManager",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotTradeAuthority",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "OracleFeedMissing",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "OraclePauseStatusUnavailable",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "OraclePaused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenIn",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "tokenOut",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "valueIn",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "valueOut",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "maximumLossBps",
        "type": "uint16"
      }
    ],
    "name": "OracleSlippageTooHigh",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PendingStrategyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProtocolDepositsPaused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Reentrancy",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      }
    ],
    "name": "RemovedAssetBalanceRemaining",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SafeTransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SafeTransferFromFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SelfAssetNotSupported",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "updatedAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxStaleness",
        "type": "uint256"
      }
    ],
    "name": "StaleOraclePrice",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StrategicRebalanceNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "activationTime",
        "type": "uint256"
      }
    ],
    "name": "StrategyActivationPending",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "nextAllowedTime",
        "type": "uint256"
      }
    ],
    "name": "StrategyChangeCooldownActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StrategyModuleCallFailed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "expected",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "actual",
        "type": "bytes32"
      }
    ],
    "name": "StrategyModuleIntegrityCheckFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StrategyRationaleRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "StrategyRationaleTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StrategyStateLocked",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StrategyTargetsUnchanged",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TargetBandsNotReached",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "TokenDecimalsUnavailable",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maximum",
        "type": "uint256"
      }
    ],
    "name": "TooManyTrades",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TrackedAssetLimitExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "TradeAssetNotTracked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "distanceBefore",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "distanceAfter",
        "type": "uint256"
      }
    ],
    "name": "TradeDoesNotImproveTarget",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnauthorizedFactory",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnauthorizedModuleCallback",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "decimals_",
        "type": "uint8"
      }
    ],
    "name": "UnsupportedDecimals",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VaultAlreadySunset",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VaultDepositsPaused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VaultSunset",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroNav",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroShares",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "enum PricingSource",
        "name": "source",
        "type": "uint8"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "priceFeed",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "quoteToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "primarySource",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "marketId",
        "type": "bytes32"
      }
    ],
    "name": "AssetPricingPinned",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "observedAt",
        "type": "uint64"
      }
    ],
    "name": "ChallengeDeadlineMissed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "rewardShares",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "forfeitedShares",
        "type": "uint256"
      }
    ],
    "name": "ChallengeRewardAccrued",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "rewardShares",
        "type": "uint256"
      }
    ],
    "name": "ChallengeRewardClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "ConstituentRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "name": "Contributed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "executor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "authorized",
        "type": "bool"
      }
    ],
    "name": "ExecutorAuthorizationChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldRecipient",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newRecipient",
        "type": "address"
      }
    ],
    "name": "FeeRecipientTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "feeShares",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "managerShares",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "protocolShares",
        "type": "uint256"
      }
    ],
    "name": "FeesAccrued",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "adapter",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "tokenIn",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "tokenOut",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountOut",
        "type": "uint256"
      }
    ],
    "name": "MaintenanceTradeExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "ManagerFeeAccrualResumed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "oldFeeBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "newFeeBps",
        "type": "uint16"
      }
    ],
    "name": "ManagerFeeRateChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newlyEscrowed",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalEscrowed",
        "type": "uint256"
      }
    ],
    "name": "ManagerFeesEscrowed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "ManagerFeesForfeited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "ManagerFeesReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldManager",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newManager",
        "type": "address"
      }
    ],
    "name": "ManagerTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "_sunsetAt",
        "type": "uint64"
      }
    ],
    "name": "OtfSunset",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "resolvedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "resolvedBeforeDeadline",
        "type": "bool"
      }
    ],
    "name": "OutOfBandChallengeResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "startedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "breachedAssets",
        "type": "address[]"
      }
    ],
    "name": "OutOfBandChallengeStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      }
    ],
    "name": "Rebalanced",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RetiringDustWrittenOff",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "rebalanceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "completedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "actualWeights",
        "type": "uint256[]"
      }
    ],
    "name": "StrategicRebalanceCompleted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "strategyVersion",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "rationale",
        "type": "string"
      }
    ],
    "name": "StrategyRationaleLocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "strategyVersion",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "proposedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "activatedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "rationale",
        "type": "string"
      }
    ],
    "name": "StrategyVersionActivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "strategyVersion",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "completedAt",
        "type": "uint64"
      }
    ],
    "name": "StrategyVersionCompleted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "rebalanceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "activator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "activatedAt",
        "type": "uint64"
      }
    ],
    "name": "TargetWeightsActivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "rebalanceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      }
    ],
    "name": "TargetWeightsProposalCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "rebalanceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "completionDeviationBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "challengeDeviationBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "proposedAt",
        "type": "uint64"
      }
    ],
    "name": "TargetWeightsProposed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "executionId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "executor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "batchLossBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "navLossBudgetUsedBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "strategyVersion",
        "type": "uint32"
      }
    ],
    "name": "TradeExecutionRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_factory",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_manager",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "_feeRecipient",
        "type": "address"
      }
    ],
    "name": "VaultInitialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "completionDeviationBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "challengeDeviationBps",
        "type": "uint16"
      }
    ],
    "name": "WeightBandsUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "stateMutability": "nonpayable",
    "type": "fallback"
  },
  {
    "inputs": [],
    "name": "acceptOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "activatePendingStrategy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cancelPendingStrategy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimChallengeReward",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "completeStrategicRebalance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "minShares",
        "type": "uint256"
      }
    ],
    "name": "contribute",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "effectiveProtocolFeeShareBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "effectiveShareBps",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "adapter",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenIn",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenOut",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minAmountOut",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "adapterData",
            "type": "bytes"
          }
        ],
        "internalType": "struct TradeInstruction[]",
        "name": "trades",
        "type": "tuple[]"
      }
    ],
    "name": "executeRebalanceTrades",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "flagOutOfBand",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "symbol",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "initialStrategyRationale",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "manager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "feeRecipient",
            "type": "address"
          },
          {
            "internalType": "address[]",
            "name": "initialAssets",
            "type": "address[]"
          },
          {
            "components": [
              {
                "internalType": "enum PricingSource",
                "name": "source",
                "type": "uint8"
              },
              {
                "internalType": "address",
                "name": "quoteToken",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "primarySource",
                "type": "address"
              },
              {
                "internalType": "uint32",
                "name": "primaryMaxStaleness",
                "type": "uint32"
              }
            ],
            "internalType": "struct AssetPricingConfig[]",
            "name": "initialPricingConfigs",
            "type": "tuple[]"
          },
          {
            "internalType": "uint16[]",
            "name": "initialTargetWeightsBps",
            "type": "uint16[]"
          },
          {
            "internalType": "uint256[]",
            "name": "initialAmounts",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256",
            "name": "initialShareSupply",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "managerFeeBpsPerYear",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "maxNavLossBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "maxWeightDeviationBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "challengeWeightDeviationBps",
            "type": "uint16"
          }
        ],
        "internalType": "struct VaultInitParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "initialize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "maxAmountsIn",
        "type": "uint256[]"
      }
    ],
    "name": "mintWithBasket",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amountsIn",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "moduleAccrueFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "enum PricingSource",
            "name": "source",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "quoteToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "primarySource",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "primaryMaxStaleness",
            "type": "uint32"
          }
        ],
        "internalType": "struct AssetPricingConfig",
        "name": "config",
        "type": "tuple"
      }
    ],
    "name": "modulePinAssetPricing",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "enum PricingSource",
            "name": "source",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "quoteToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "primarySource",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "primaryMaxStaleness",
            "type": "uint32"
          }
        ],
        "internalType": "struct AssetPricingConfig",
        "name": "config",
        "type": "tuple"
      }
    ],
    "name": "modulePrepareAssetPricing",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "moduleReleaseChallengeFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      },
      {
        "internalType": "string",
        "name": "rationale",
        "type": "string"
      }
    ],
    "name": "proposeStrategy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      },
      {
        "components": [
          {
            "internalType": "enum PricingSource",
            "name": "source",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "quoteToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "primarySource",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "primaryMaxStaleness",
            "type": "uint32"
          }
        ],
        "internalType": "struct AssetPricingConfig[]",
        "name": "pricingConfigs",
        "type": "tuple[]"
      },
      {
        "internalType": "string",
        "name": "rationale",
        "type": "string"
      }
    ],
    "name": "proposeStrategyWithPricing",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pruneRetiredAssets",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "removed",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address[]",
        "name": "newTokens",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "newWeights",
        "type": "uint256[]"
      }
    ],
    "name": "rebalance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "shareOwner",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "minAmountsOut",
        "type": "uint256[]"
      }
    ],
    "name": "redeem",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amountsOut",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "resolveOutOfBandChallenge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "executor",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "authorized",
        "type": "bool"
      }
    ],
    "name": "setExecutor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newFeeRecipient",
        "type": "address"
      }
    ],
    "name": "setFeeRecipient",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "newFeeBps",
        "type": "uint16"
      }
    ],
    "name": "setManagerFeeBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "rationale",
        "type": "string"
      }
    ],
    "name": "setNextStrategyRationale",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "completionDeviationBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "challengeDeviationBps_",
        "type": "uint16"
      }
    ],
    "name": "setWeightBands",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strategyModule",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strategyModuleCodehash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sunsetOtf",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tokenURI",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "viewModule",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "viewModuleCodehash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "minAmounts",
        "type": "uint256[]"
      }
    ],
    "name": "withdraw",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawManagerFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "feeShares",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "contract PortfolioCalculator",
        "name": "portfolioCalculator_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "assetMarketRegistry",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "assets",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "executor",
        "type": "address"
      }
    ],
    "name": "authorizedExecutor",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "authorizedExecutors",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "executors",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "canProposeStrategy",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeCaller",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeDeadline",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "challengeRewardShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeStartedAt",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeTimeRemaining",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeWeightDeviationBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "currentWeight",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "weight",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentWeightsBps",
    "outputs": [
      {
        "internalType": "uint16[]",
        "name": "weights",
        "type": "uint16[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "escrowedManagerFeeShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "factory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feeCollector",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feeRecipient",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feeState",
    "outputs": [
      {
        "internalType": "enum ManagedOTFVaultStorage.FeeState",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "forfeitedManagerFeeShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getConstituents",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "tokens",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "weights",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "getReserve",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "getStrategyTargets",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "tokens",
        "type": "address[]"
      },
      {
        "internalType": "uint16[]",
        "name": "weights",
        "type": "uint16[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "getStrategyVersion",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint64",
            "name": "proposedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "activatedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "completedAt",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "author",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "rationale",
            "type": "string"
          }
        ],
        "internalType": "struct StrategyVersion",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "getWeight",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "weight",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "getWeightBands",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "challengeLower",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "challengeUpper",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "completionLower",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "completionUpper",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "isConstituent",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isWithinChallengeBands",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isWithinTargetBands",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastCompletedStrategyTimestamp",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastFeeAccrualTimestamp",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "manager",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "managerFeeBpsPerYear",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxNavLossBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxWeightDeviationBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "navLossBudgetState",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "recoveryAt",
        "type": "uint64"
      },
      {
        "internalType": "uint16",
        "name": "usedLossBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "maximumLossBps",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "navPerShare",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextStrategyChangeTime",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextStrategyRationale",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingManager",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingStrategyActivationTime",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingStrategyProposedAt",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingStrategyRationale",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "name": "previewContribute",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "maxAmountsIn",
        "type": "uint256[]"
      }
    ],
    "name": "previewMaxMint",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "uint256[]",
        "name": "amountsIn",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      }
    ],
    "name": "previewMint",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amountsIn",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      }
    ],
    "name": "previewRedeem",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amountsOut",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "lpAmount",
        "type": "uint256"
      }
    ],
    "name": "previewWithdraw",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "pricingConfigForAsset",
    "outputs": [
      {
        "internalType": "bool",
        "name": "configured",
        "type": "bool"
      },
      {
        "internalType": "enum PricingSource",
        "name": "source",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "quoteToken",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "primarySource",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "secondarySource",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "normalizedPriceFeed",
        "type": "address"
      },
      {
        "internalType": "uint32",
        "name": "primaryMaxStaleness",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "secondaryMaxStaleness",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rebalanceCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rebalanceExecutor",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "recentRebalanceCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "recentRebalanceRecord",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint64",
            "name": "timestamp",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "manager",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "navPerShareBefore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "navPerShareAfter",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "turnoverBps",
            "type": "uint16"
          },
          {
            "internalType": "uint32",
            "name": "executionLossBps",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "strategyVersion",
            "type": "uint32"
          }
        ],
        "internalType": "struct RebalanceRecord",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "recentTradeExecutionCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "recentTradeExecutionRecord",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint64",
            "name": "timestamp",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "executor",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "strategyVersion",
            "type": "uint32"
          },
          {
            "internalType": "uint256",
            "name": "navBefore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "navAfter",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "batchLossBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "navLossBudgetUsedBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "tradeCount",
            "type": "uint16"
          }
        ],
        "internalType": "struct TradeExecutionRecord",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strategicRebalanceActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strategyProposalPending",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strategyVersionCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sunset",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sunsetAt",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "targetWeightBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalAssetsValue",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "nav",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalBasketValue",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalConstituents",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tradeExecutionCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  }
] as const;

export const otfEntryExitRouterAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "factory_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "observed",
        "type": "uint256"
      }
    ],
    "name": "AdapterOutputMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      }
    ],
    "name": "DeadlineExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "InputAmountMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidArrayLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "dependency",
        "type": "address"
      }
    ],
    "name": "InvalidDependency",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "InvalidDirectLeg",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vault",
        "type": "address"
      }
    ],
    "name": "InvalidVault",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minimum",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "MinimumOutputNotMet",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProtocolDepositsPaused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Reentrancy",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SafeApproveFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SafeTransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SafeTransferFromFailed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "senderDelta",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "receiverDelta",
        "type": "uint256"
      }
    ],
    "name": "TokenTransferMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "adapter",
        "type": "address"
      }
    ],
    "name": "UnapprovedTradeAdapter",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vault",
        "type": "address"
      }
    ],
    "name": "VaultDepositsPaused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "VaultInputMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "reported",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "observed",
        "type": "uint256"
      }
    ],
    "name": "VaultOutputMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroInputAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroMinimumOutput",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroShares",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "vault",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "inputToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "inputAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "inputRefunded",
        "type": "uint256"
      }
    ],
    "name": "EnteredWithToken",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "vault",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "outputToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "outputReceived",
        "type": "uint256"
      }
    ],
    "name": "RedeemedToToken",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vault",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "inputToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "inputAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minShares",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "adapter",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "inputAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minAssetOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minRefundInputRate",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "adapterData",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "refundAdapterData",
            "type": "bytes"
          }
        ],
        "internalType": "struct EntrySwap[]",
        "name": "swaps",
        "type": "tuple[]"
      }
    ],
    "name": "enterWithToken",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "inputRefunded",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "factory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vault",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "outputToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "minOutputAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "adapter",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "minOutputAmount",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "adapterData",
            "type": "bytes"
          }
        ],
        "internalType": "struct ExitSwap[]",
        "name": "swaps",
        "type": "tuple[]"
      }
    ],
    "name": "redeemToToken",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "outputReceived",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const registeredUniswapV3AdapterAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "pendingOwner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptOwnership",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "setCallerApproved",
    stateMutability: "nonpayable",
    inputs: [
      { name: "caller", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isCallerApproved",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "previousOwner", type: "address" },
      { indexed: true, name: "newOwner", type: "address" },
    ],
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    anonymous: false,
    inputs: [
      { indexed: true, name: "previousOwner", type: "address" },
      { indexed: true, name: "newOwner", type: "address" },
    ],
  },
] as const;

export const otfFactoryAbi = [
  {
    type: "function",
    name: "MIN_CHALLENGE_GRACE_PERIOD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "MAX_CHALLENGE_GRACE_PERIOD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "otfTokenURI",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "minTargetWeightBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "minCompletionDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "maxCompletionDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "minChallengeDeviationGapBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "maxChallengeDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "setWeightBandLimits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newMinCompletionDeviationBps", type: "uint16" },
      { name: "newMaxCompletionDeviationBps", type: "uint16" },
      { name: "newMinChallengeDeviationGapBps", type: "uint16" },
      { name: "newMaxChallengeDeviationBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "WeightBandLimitsUpdated",
    anonymous: false,
    inputs: [
      { indexed: false, name: "minCompletionDeviationBps", type: "uint16" },
      { indexed: false, name: "maxCompletionDeviationBps", type: "uint16" },
      { indexed: false, name: "minChallengeDeviationGapBps", type: "uint16" },
      { indexed: false, name: "maxChallengeDeviationBps", type: "uint16" },
    ],
  },
  {
    type: "function",
    name: "challengeGracePeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "setChallengeGracePeriod",
    stateMutability: "nonpayable",
    inputs: [{ name: "newPeriod", type: "uint32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "ChallengeGracePeriodUpdated",
    anonymous: false,
    inputs: [
      { indexed: false, name: "previousPeriod", type: "uint32" },
      { indexed: false, name: "newPeriod", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "depositsPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "vaultDepositsPaused",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setVaultDepositsPaused",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "paused", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "VaultDepositsPauseChanged",
    inputs: [
      { indexed: true, name: "vault", type: "address" },
      { indexed: false, name: "paused", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "setDepositsPaused",
    stateMutability: "nonpayable",
    inputs: [{ name: "paused", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setMinTargetWeightBps",
    stateMutability: "nonpayable",
    inputs: [{ name: "newMinimumBps", type: "uint16" }],
    outputs: [],
  },
  {
    type: "function",
    name: "assetMarketRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "pricingResolver",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "protocolFeeShareBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "vaultAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isAdapterApproved",
    stateMutability: "view",
    inputs: [
      { name: "adapter", type: "address" },
      { name: "approvalType", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setAdapterPermissions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" },
      { name: "rebalance", type: "bool" },
      { name: "entry", type: "bool" },
      { name: "exit", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "AdapterPermissionsSet",
    anonymous: false,
    inputs: [
      { indexed: true, name: "adapter", type: "address" },
      { indexed: false, name: "rebalance", type: "bool" },
      { indexed: false, name: "entry", type: "bool" },
      { indexed: false, name: "exit", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "createVault",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "initialStrategyRationale", type: "string" },
          { name: "manager", type: "address" },
          { name: "feeRecipient", type: "address" },
          { name: "initialAssets", type: "address[]" },
          {
            name: "initialPricingConfigs",
            type: "tuple[]",
            components: [
              { name: "source", type: "uint8" },
              { name: "quoteToken", type: "address" },
              { name: "primarySource", type: "address" },
              { name: "primaryMaxStaleness", type: "uint32" },
            ],
          },
          { name: "initialTargetWeightsBps", type: "uint16[]" },
          { name: "initialAmounts", type: "uint256[]" },
          { name: "initialShareSupply", type: "uint256" },
          { name: "managerFeeBpsPerYear", type: "uint16" },
          { name: "maxNavLossBps", type: "uint16" },
          { name: "maxWeightDeviationBps", type: "uint16" },
          { name: "challengeWeightDeviationBps", type: "uint16" },
        ],
      },
    ],
    outputs: [{ name: "vault", type: "address" }],
  },
] as const;
