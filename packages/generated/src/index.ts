export const managedOtfVaultAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "portfolioCalculator_",
        "type": "address",
        "internalType": "contract PortfolioCalculator"
      },
      {
        "name": "strategyModule_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "viewModule_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "fallback",
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activatePendingStrategy",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelPendingStrategy",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimChallengeReward",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "completeStrategicRebalance",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "contribute",
    "inputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minShares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "effectiveProtocolFeeShareBps",
    "inputs": [],
    "outputs": [
      {
        "name": "effectiveShareBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executeRebalanceTrades",
    "inputs": [
      {
        "name": "trades",
        "type": "tuple[]",
        "internalType": "struct TradeInstruction[]",
        "components": [
          {
            "name": "adapter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenIn",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minAmountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "adapterData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "flagOutOfBand",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "initialize",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct VaultInitParams",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "initialStrategyRationale",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "manager",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "initialAssets",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "initialPricingConfigs",
            "type": "tuple[]",
            "internalType": "struct AssetPricingConfig[]",
            "components": [
              {
                "name": "source",
                "type": "uint8",
                "internalType": "enum PricingSource"
              },
              {
                "name": "quoteToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "primarySource",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "primaryMaxStaleness",
                "type": "uint32",
                "internalType": "uint32"
              }
            ]
          },
          {
            "name": "initialTargetWeightsBps",
            "type": "uint16[]",
            "internalType": "uint16[]"
          },
          {
            "name": "initialAmounts",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "initialShareSupply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "managerFeeBpsPerYear",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxNavLossBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxWeightDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "challengeWeightDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintWithBasket",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxAmountsIn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "amountsIn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "moduleAccrueFees",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "moduleClearAssetPricing",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "modulePinAssetPricing",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct AssetPricingConfig",
        "components": [
          {
            "name": "source",
            "type": "uint8",
            "internalType": "enum PricingSource"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primarySource",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primaryMaxStaleness",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "modulePrepareAssetPricing",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct AssetPricingConfig",
        "components": [
          {
            "name": "source",
            "type": "uint8",
            "internalType": "enum PricingSource"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primarySource",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primaryMaxStaleness",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "moduleReleaseChallengeFees",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeStrategy",
    "inputs": [
      {
        "name": "newTokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "rationale",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "proposeStrategyWithPricing",
    "inputs": [
      {
        "name": "newTokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "pricingConfigs",
        "type": "tuple[]",
        "internalType": "struct AssetPricingConfig[]",
        "components": [
          {
            "name": "source",
            "type": "uint8",
            "internalType": "enum PricingSource"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primarySource",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "primaryMaxStaleness",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "name": "rationale",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pruneRetiredAssets",
    "inputs": [],
    "outputs": [
      {
        "name": "removed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rebalance",
    "inputs": [
      {
        "name": "newTokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "redeem",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "shareOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minAmountsOut",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "amountsOut",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resolveOutOfBandChallenge",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setExecutor",
    "inputs": [
      {
        "name": "executor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "authorized",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeRecipient",
    "inputs": [
      {
        "name": "newFeeRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setManagerFeeBps",
    "inputs": [
      {
        "name": "newFeeBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setNextStrategyRationale",
    "inputs": [
      {
        "name": "rationale",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setWeightBands",
    "inputs": [
      {
        "name": "completionDeviationBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "challengeDeviationBps_",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "strategyModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "strategyModuleCodehash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sunsetOtf",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "tokenURI",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "viewModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "viewModuleCodehash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minAmounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawManagerFees",
    "inputs": [],
    "outputs": [
      {
        "name": "feeShares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetPricingPinned",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "source",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum PricingSource"
      },
      {
        "name": "priceFeed",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "primarySource",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeDeadlineMissed",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "observedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeRewardAccrued",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rewardShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "forfeitedShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeRewardClaimed",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rewardShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ConstituentRemoved",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Contributed",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExecutorAuthorizationChanged",
    "inputs": [
      {
        "name": "executor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "authorized",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeRecipientTransferred",
    "inputs": [
      {
        "name": "oldRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesAccrued",
    "inputs": [
      {
        "name": "feeShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "managerShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "protocolShares",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MaintenanceTradeExecuted",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "adapter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerFeeAccrualResumed",
    "inputs": [
      {
        "name": "timestamp",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerFeeRateChanged",
    "inputs": [
      {
        "name": "oldFeeBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "newFeeBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerFeesEscrowed",
    "inputs": [
      {
        "name": "newlyEscrowed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalEscrowed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerFeesForfeited",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerFeesReleased",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ManagerTransferred",
    "inputs": [
      {
        "name": "oldManager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newManager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OtfSunset",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "_sunsetAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OutOfBandChallengeResolved",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "resolvedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "resolvedBeforeDeadline",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OutOfBandChallengeStarted",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "breachedAssets",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Rebalanced",
    "inputs": [
      {
        "name": "newTokens",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RetiringDustWrittenOff",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategicRebalanceCompleted",
    "inputs": [
      {
        "name": "rebalanceId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "completedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "actualWeights",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyRationaleLocked",
    "inputs": [
      {
        "name": "strategyVersion",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rationale",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyVersionActivated",
    "inputs": [
      {
        "name": "strategyVersion",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "proposedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "activatedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "rationale",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyVersionCompleted",
    "inputs": [
      {
        "name": "strategyVersion",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "completedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TargetWeightsActivated",
    "inputs": [
      {
        "name": "rebalanceId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "activator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newTokens",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "activatedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TargetWeightsProposalCancelled",
    "inputs": [
      {
        "name": "rebalanceId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TargetWeightsProposed",
    "inputs": [
      {
        "name": "rebalanceId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newTokens",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "newWeights",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "completionDeviationBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "challengeDeviationBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "proposedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TradeExecutionRecorded",
    "inputs": [
      {
        "name": "executionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "executor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "batchLossBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "navLossBudgetUsedBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "strategyVersion",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultInitialized",
    "inputs": [
      {
        "name": "_factory",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "_manager",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "_feeRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WeightBandsUpdated",
    "inputs": [
      {
        "name": "completionDeviationBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "challengeDeviationBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AmountTooHigh",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "AmountTooLow",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetMovedAwayFromTarget",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deviationBefore",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deviationAfter",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetNotContract",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetPricingAlreadyPinned",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetTransferMismatch",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "senderDelta",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiverDelta",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetWeightTooLow",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "weightBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadTrade",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ChallengeAlreadyActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ChallengeNotActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DepositsPausedForRetiringAsset",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DirectStrategyCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DuplicateConstituent",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20AlreadyInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ERC20InsufficientAllowance",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidReceiver",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20NonZeroAllowance",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "currentAllowance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyPortfolio",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExecutorAlreadyAuthorized",
    "inputs": [
      {
        "name": "executor",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExecutorLimitReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExecutorNotAuthorized",
    "inputs": [
      {
        "name": "executor",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IncompleteOracleRound",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "roundId",
        "type": "uint80",
        "internalType": "uint80"
      },
      {
        "name": "answeredInRound",
        "type": "uint80",
        "internalType": "uint80"
      }
    ]
  },
  {
    "type": "error",
    "name": "InitialAmountZero",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InitialBalanceMismatch",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InitialShareSupplyTooSmall",
    "inputs": [
      {
        "name": "supplied",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientAmount",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientShares",
    "inputs": [
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidArrayLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidOraclePrice",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "answer",
        "type": "int256",
        "internalType": "int256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleTimestamp",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "updatedAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReceiver",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRecordIndex",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRoleAddress",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidWeightBands",
    "inputs": [
      {
        "name": "completionDeviationBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "challengeDeviationBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidWeightSum",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidWeights",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": [
      {
        "name": "tokensLength",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountsLength",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ManagerFeeTooHigh",
    "inputs": [
      {
        "name": "supplied",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maximum",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "NavLossBudgetExceeded",
    "inputs": [
      {
        "name": "usedLossBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "batchLossBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximumLossBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "NavLossTooHigh",
    "inputs": [
      {
        "name": "navBefore",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "navAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximumLossBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoChallengeBreach",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingStrategy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonProportionalContribution",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "supplied",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotConstituent",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotTradeAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OracleFeedMissing",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OraclePauseStatusUnavailable",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OraclePaused",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OracleSlippageTooHigh",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "valueIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "valueOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximumLossBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PendingStrategyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ProtocolDepositsPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Reentrancy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RemovedAssetBalanceRemaining",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeTransferFromFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SelfAssetNotSupported",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StaleOraclePrice",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "updatedAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxStaleness",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategicRebalanceNotActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StrategyActivationPending",
    "inputs": [
      {
        "name": "activationTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategyChangeCooldownActive",
    "inputs": [
      {
        "name": "nextAllowedTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategyModuleCallFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StrategyModuleIntegrityCheckFailed",
    "inputs": [
      {
        "name": "expected",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actual",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategyRationaleRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StrategyRationaleTooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategyStateLocked",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StrategyTargetsUnchanged",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TargetBandsNotReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenDecimalsUnavailable",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooManyTrades",
    "inputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TrackedAssetLimitExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TradeAssetNotTracked",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradeDoesNotImproveTarget",
    "inputs": [
      {
        "name": "distanceBefore",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "distanceAfter",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnauthorizedFactory",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnauthorizedModuleCallback",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedDecimals",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "decimals_",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "VaultAlreadySunset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VaultDepositsPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VaultSunset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroNav",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroShares",
    "inputs": []
  },
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "portfolioCalculator_",
        "type": "address",
        "internalType": "contract PortfolioCalculator"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "assetMarketRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "assets",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authorizedExecutor",
    "inputs": [
      {
        "name": "executor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authorizedExecutors",
    "inputs": [],
    "outputs": [
      {
        "name": "executors",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "canProposeStrategy",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeActive",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeCaller",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeDeadline",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeRewardShares",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeStartedAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeTimeRemaining",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeWeightDeviationBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentWeight",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "weight",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentWeightsBps",
    "inputs": [],
    "outputs": [
      {
        "name": "weights",
        "type": "uint16[]",
        "internalType": "uint16[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "escrowedManagerFeeShares",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "factory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeCollector",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeRecipient",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeState",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum ManagedOTFVaultStorage.FeeState"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "forfeitedManagerFeeShares",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getConstituents",
    "inputs": [],
    "outputs": [
      {
        "name": "tokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "weights",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getReserve",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getStrategyTargets",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "tokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "weights",
        "type": "uint16[]",
        "internalType": "uint16[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getStrategyVersion",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct StrategyVersion",
        "components": [
          {
            "name": "proposedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "activatedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "completedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "author",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "rationale",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getWeight",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "weight",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getWeightBands",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "challengeLower",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "challengeUpper",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "completionLower",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "completionUpper",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isConstituent",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isWithinChallengeBands",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isWithinTargetBands",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastCompletedStrategyTimestamp",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastFeeAccrualTimestamp",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "manager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "managerFeeBpsPerYear",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxNavLossBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxWeightDeviationBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "navLossBudgetState",
    "inputs": [],
    "outputs": [
      {
        "name": "recoveryAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "usedLossBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maximumLossBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "navPerShare",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextStrategyChangeTime",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextStrategyRationale",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingStrategyActivationTime",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingStrategyProposedAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingStrategyRationale",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewContribute",
    "inputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewMaxMint",
    "inputs": [
      {
        "name": "maxAmountsIn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountsIn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewMint",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amountsIn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewRedeem",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amountsOut",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewWithdraw",
    "inputs": [
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pricingConfigForAsset",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "configured",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "source",
        "type": "uint8",
        "internalType": "enum PricingSource"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "primarySource",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "secondarySource",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "normalizedPriceFeed",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "primaryMaxStaleness",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "secondaryMaxStaleness",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rebalanceCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rebalanceExecutor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recentRebalanceCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recentRebalanceRecord",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RebalanceRecord",
        "components": [
          {
            "name": "timestamp",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "manager",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "navPerShareBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "navPerShareAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "turnoverBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "executionLossBps",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "strategyVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recentTradeExecutionCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recentTradeExecutionRecord",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TradeExecutionRecord",
        "components": [
          {
            "name": "timestamp",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "executor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "strategyVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "navBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "navAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "batchLossBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "navLossBudgetUsedBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "tradeCount",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "strategicRebalanceActive",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "strategyProposalPending",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "strategyVersionCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sunset",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sunsetAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "targetWeightBps",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalAssetsValue",
    "inputs": [],
    "outputs": [
      {
        "name": "nav",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalBasketValue",
    "inputs": [],
    "outputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalConstituents",
    "inputs": [],
    "outputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tradeExecutionCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  }
] as const;

export const otfEntryRouterAbi = [
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
    name: "settlementToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isEntryAdapterApproved",
    stateMutability: "view",
    inputs: [{ name: "adapter", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "enterWithSettlement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "settlementIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "deadline", type: "uint256" },
      {
        name: "swaps",
        type: "tuple[]",
        components: [
          { name: "adapter", type: "address" },
          { name: "settlementIn", type: "uint256" },
          { name: "minAssetOut", type: "uint256" },
          { name: "minRefundSettlementRate", type: "uint256" },
          { name: "adapterData", type: "bytes" },
          { name: "refundAdapterData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "shares", type: "uint256" },
      { name: "settlementRefunded", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "redeemToSettlement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "minSettlementOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      {
        name: "swaps",
        type: "tuple[]",
        components: [
          { name: "adapter", type: "address" },
          { name: "minSettlementOut", type: "uint256" },
          { name: "adapterData", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "settlementReceived", type: "uint256" }],
  },
  {
    type: "event",
    name: "EnteredWithSettlement",
    anonymous: false,
    inputs: [
      { indexed: true, name: "payer", type: "address" },
      { indexed: true, name: "receiver", type: "address" },
      { indexed: true, name: "vault", type: "address" },
      { indexed: false, name: "settlementIn", type: "uint256" },
      { indexed: false, name: "shares", type: "uint256" },
      { indexed: false, name: "settlementRefunded", type: "uint256" },
    ],
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
