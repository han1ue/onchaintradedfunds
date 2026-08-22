// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "./ERC20Base.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import {
    AssetPricingConfig,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord
} from "./VaultTypes.sol";

interface IProtocolPortfolioLimits {
    function minTargetWeightBps() external view returns (uint16);
    function depositsPaused() external view returns (bool);
    function vaultDepositsPaused(address vault) external view returns (bool);
    function pricingResolver() external view returns (address);
    function otfTokenURI() external pure returns (string memory);
}

interface IProtocolTokenFeePolicy {
    function effectiveProtocolFeeShareBps(address vault) external view returns (uint16);
}

interface IManagedOTFVaultAssetCleanup {
    function moduleClearAssetPricing(address asset) external;
}

abstract contract ManagedOTFVaultStorage is ERC20Base {
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant STRATEGY_CHANGE_COOLDOWN = 14 days;
    uint256 public constant STRATEGY_ACTIVATION_DELAY = 48 hours;
    uint32 public constant CHALLENGE_GRACE_PERIOD = 7 days;
    uint256 public constant MAX_STRATEGY_RATIONALE_BYTES = 2_048;
    uint256 public constant MAX_TRADE_COUNT = 20;
    uint256 public constant MAX_AUTHORIZED_EXECUTORS = 20;
    uint256 internal constant MAX_TRACKED_ASSETS = ProtocolConstants.MAX_TRACKED_ASSETS;
    /// @notice Time required for a fully consumed NAV-loss budget to replenish.
    uint256 public constant NAV_LOSS_RECOVERY_PERIOD = 7 days;
    uint256 public constant MINIMUM_LIQUIDITY_SHARES = 1_000_000;
    /// @notice Maximum retiring balance that may be written off and pruned.
    /// @dev Approved constituents are restricted to 18 decimals, so this is 1e-9 tokens.
    uint256 public constant MAX_RETIRING_DUST = 1_000_000_000;
    uint16 public constant CHALLENGE_CALLER_REWARD_BPS = 5_000;
    uint16 public constant MAX_MANAGER_FEE_BPS_PER_YEAR =
        ProtocolConstants.MAX_ANNUAL_MANAGER_FEE_BPS;
    uint16 public constant MAX_COMPLETION_DEVIATION_BPS = 1_000;
    uint16 public constant MAX_BAND_DEVIATION_BPS = 2_500;
    uint256 internal constant RECENT_REBALANCE_CAP = 16;
    uint256 internal constant RECENT_EXECUTION_CAP = 16;
    bytes4 internal constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 internal constant ERC173_INTERFACE_ID = 0x7f5828d0;
    bytes4 internal constant ERC7621_INTERFACE_ID = 0xc9c80f73;

    error AlreadyInitialized();
    error NotInitialized();
    error UnauthorizedFactory();
    error StrategyChangeCooldownActive(uint256 nextAllowedTime);
    error StrategyActivationPending(uint256 activationTime);
    error NoPendingStrategy();
    error PendingStrategyExists();
    error NotManager();
    error NotTradeAuthority();
    error InvalidArrayLength();
    error EmptyPortfolio();
    error InitialShareSupplyTooSmall(uint256 supplied, uint256 minimum);
    error InitialAmountZero(address asset);
    error InitialBalanceMismatch(address asset, uint256 expected, uint256 actual);
    error AssetTransferMismatch(
        address asset, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error InvalidRoleAddress(address account);
    error InvalidReceiver(address receiver);
    error AssetNotContract(address asset);
    error SelfAssetNotSupported();
    error InvalidWeightSum(uint256 sum);
    error AssetWeightTooLow(address asset, uint256 weightBps, uint256 minimum);
    error TrackedAssetLimitExceeded();
    error InvalidWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps);
    error StrategyRationaleTooLong(uint256 length);
    error StrategyRationaleRequired();
    error StrategyTargetsUnchanged();
    error Reentrancy();
    error ZeroShares();
    error AmountTooHigh(address asset, uint256 required, uint256 maximum);
    error AmountTooLow(address asset, uint256 actual, uint256 minimum);
    error NonProportionalContribution(address asset, uint256 supplied, uint256 required);
    error DepositsPausedForRetiringAsset(address asset);
    error OracleFeedMissing(address asset);
    error InvalidOraclePrice(address asset, int256 answer);
    error InvalidOracleTimestamp(address asset, uint256 updatedAt);
    error IncompleteOracleRound(address asset, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address asset, uint256 updatedAt, uint256 maxStaleness);
    error OraclePauseStatusUnavailable(address asset);
    error OraclePaused(address asset);
    error TokenDecimalsUnavailable(address token);
    error UnsupportedDecimals(address token, uint8 decimals_);
    error ZeroNav();
    error NavLossTooHigh(uint256 navBefore, uint256 navAfter, uint16 maximumLossBps);
    error NavLossBudgetExceeded(uint256 usedLossBps, uint256 batchLossBps, uint16 maximumLossBps);
    error OracleSlippageTooHigh(
        address tokenIn, address tokenOut, uint256 valueIn, uint256 valueOut, uint16 maximumLossBps
    );
    error TradeDoesNotImproveTarget(uint256 distanceBefore, uint256 distanceAfter);
    error AssetMovedAwayFromTarget(address asset, uint256 deviationBefore, uint256 deviationAfter);
    error RemovedAssetBalanceRemaining(address asset, uint256 balance);
    error TooManyTrades(uint256 count, uint256 maximum);
    error BadTrade(address tokenIn, address tokenOut, uint256 amountIn);
    error TradeAssetNotTracked(address token);
    error UnapprovedAdapter(address adapter);
    error InvalidRecordIndex(uint256 index);
    error StrategyStateLocked();
    error StrategicRebalanceNotActive();
    error TargetBandsNotReached();
    error NoChallengeBreach();
    error ChallengeAlreadyActive();
    error ChallengeNotActive();
    error ExecutorLimitReached();
    error ExecutorAlreadyAuthorized(address executor);
    error ExecutorNotAuthorized(address executor);
    error ManagerFeeTooHigh(uint16 supplied, uint16 maximum);
    error StrategyModuleCallFailed();
    error StrategyModuleIntegrityCheckFailed(bytes32 expected, bytes32 actual);
    error DirectStrategyCall();
    error UnauthorizedModuleCallback();
    error LengthMismatch(uint256 tokensLength, uint256 amountsLength);
    error InvalidWeights(uint256 sum);
    error ZeroAmount();
    error NotConstituent(address token);
    error InsufficientShares(uint256 minimum, uint256 actual);
    error InsufficientAmount(uint256 index, uint256 minimum, uint256 actual);
    error DuplicateConstituent(address token);
    error ZeroAddress();
    error VaultAlreadySunset();
    error VaultSunset();
    error ProtocolDepositsPaused();
    error VaultDepositsPaused();
    error AssetMarketRegistryNotConfigured();
    error PricingResolverNotConfigured();
    error InvalidAssetMarket(address asset, bytes32 marketId);
    error InvalidPricingConfig(address asset);
    error PriceFeedMismatch(address asset, address expected, address supplied);
    error AssetPricingAlreadyPinned(address asset);

    enum FeeState {
        Accruing,
        Escrowed,
        Suspended,
        Sunset
    }

    event VaultInitialized(
        address indexed factory, address indexed manager, address indexed feeRecipient
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeesAccrued(uint256 feeShares, uint256 managerShares, uint256 protocolShares);
    event StrategyRationaleLocked(
        uint256 indexed strategyVersion, address indexed manager, string rationale
    );
    event StrategyVersionActivated(
        uint256 indexed strategyVersion,
        address indexed manager,
        uint64 proposedAt,
        uint64 activatedAt,
        string rationale
    );
    event StrategyVersionCompleted(uint256 indexed strategyVersion, uint64 completedAt);
    event ManagerTransferred(address indexed oldManager, address indexed newManager);
    event FeeRecipientTransferred(address indexed oldRecipient, address indexed newRecipient);
    event ExecutorAuthorizationChanged(address indexed executor, bool authorized);
    event ManagerFeeRateChanged(uint16 oldFeeBps, uint16 newFeeBps);
    event WeightBandsUpdated(uint16 completionDeviationBps, uint16 challengeDeviationBps);
    event TargetWeightsProposed(
        uint256 indexed rebalanceId,
        address indexed manager,
        address[] newTokens,
        uint256[] newWeights,
        uint16 completionDeviationBps,
        uint16 challengeDeviationBps,
        uint64 proposedAt
    );
    event TargetWeightsActivated(
        uint256 indexed rebalanceId,
        address indexed activator,
        address[] newTokens,
        uint256[] newWeights,
        uint64 activatedAt
    );
    event TargetWeightsProposalCancelled(uint256 indexed rebalanceId, address indexed manager);
    event StrategicRebalanceCompleted(
        uint256 indexed rebalanceId,
        address indexed manager,
        uint64 completedAt,
        uint256[] actualWeights
    );
    event MaintenanceTradeExecuted(
        address indexed caller,
        address indexed adapter,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event TradeExecutionRecorded(
        uint256 indexed executionId,
        address indexed executor,
        uint16 batchLossBps,
        uint16 navLossBudgetUsedBps,
        uint32 strategyVersion
    );
    event OutOfBandChallengeStarted(
        address indexed caller, uint64 startedAt, uint64 deadline, address[] breachedAssets
    );
    event OutOfBandChallengeResolved(
        address indexed caller, uint64 resolvedAt, bool resolvedBeforeDeadline
    );
    event ChallengeDeadlineMissed(uint64 deadline, uint64 observedAt);
    event ManagerFeesEscrowed(uint256 newlyEscrowed, uint256 totalEscrowed);
    event ManagerFeesReleased(address indexed recipient, uint256 amount);
    event ManagerFeesForfeited(uint256 amount);
    event ChallengeRewardAccrued(
        address indexed caller, uint256 rewardShares, uint256 forfeitedShares
    );
    event ChallengeRewardClaimed(address indexed caller, uint256 rewardShares);
    event ManagerFeeAccrualSuspended(uint64 timestamp);
    event ManagerFeeAccrualResumed(uint64 timestamp);
    event Contributed(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Withdrawn(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Rebalanced(address[] newTokens, uint256[] newWeights);
    event ConstituentRemoved(address indexed asset);
    event RetiringDustWrittenOff(address indexed asset, uint256 amount);
    event OtfSunset(address indexed caller, uint64 sunsetAt);

    bool internal _initialized;
    uint256 internal _entered;

    address public factory;
    address public manager;
    address public feeRecipient;
    address public feeCollector;
    address public assetRegistry;
    // Reserved for a removed dependency pointer in already-deployed clone layouts.
    address private __removedDependencySlot;
    address public rebalanceExecutor;

    uint16 public creatorFeeBpsPerYear;
    uint16 public protocolFeeShareBps;
    uint16 public maxNavLossBps;
    uint16 public maxWeightDeviationBps;
    uint16 public challengeWeightDeviationBps;
    uint64 public lastFeeAccrualTimestamp;
    uint64 public lastCompletedStrategyTimestamp;
    uint64 public strategicRebalanceStartedAt;
    uint64 public pendingStrategyProposedAt;
    uint64 public pendingStrategyActivationTime;

    uint256 public rebalanceCount;
    uint256 public escrowedManagerFeeShares;
    uint256 public forfeitedManagerFeeShares;
    bool public strategicRebalanceActive;
    bool public strategyProposalPending;
    bool public challengeActive;
    address public challengeCaller;
    uint64 public challengeStartedAt;
    uint64 public challengeDeadline;
    mapping(address => uint16) public targetWeightBps;
    mapping(address => bool) public authorizedExecutor;
    mapping(address => uint256) public challengeRewardShares;

    FeeState internal _feeState;
    uint256 internal _strategicNavPerShareBefore;
    uint16 internal _strategicTurnoverBps;
    address[] internal _assets;
    address[] internal _pendingAssets;
    uint16[] internal _pendingTargetWeightsBps;
    string internal _pendingStrategyRationale;
    string internal _nextStrategyRationale;
    address[] internal _authorizedExecutors;
    mapping(address => uint256) internal _executorIndexPlusOne;
    StrategyVersion[] internal _strategyVersions;
    mapping(uint256 => address[]) internal _strategyAssets;
    mapping(uint256 => uint16[]) internal _strategyTargetWeightsBps;
    RebalanceRecord[16] internal _recentRebalances;
    uint256 internal _feeAccrualRemainderWad;
    uint16 internal _protocolFeeSplitRemainderBps;
    bool public sunset;
    uint64 public sunsetAt;
    /// @dev Timestamp when the currently consumed NAV-loss capacity is fully replenished.
    uint64 internal _navLossBucketRecoveryAt;
    uint32 internal _strategicExecutionLossBps;
    uint256 public tradeExecutionCount;
    TradeExecutionRecord[16] internal _recentTradeExecutions;
    uint256 internal _challengeFeeAccrualRemainderWad;

    // Version-2 storage. Appended so the clone layout used by the incumbent stack is preserved.
    // Kept internal so delegatecall modules do not each embed duplicate public
    // getter bytecode. ManagedOTFVault exposes the canonical read surface.
    address internal _assetMarketRegistry;
    mapping(address => bytes32) internal _marketIdForAsset;
    mapping(address => address) internal _priceFeedForAsset;

    // Pricing identity is pinned while an asset remains tracked and is never
    // read through a mutable global source after selection. Fully pruned assets release their
    // pricing identity so a later strategy may reintroduce them with a newly validated source.
    // The legacy market fields above retain their original slots.
    mapping(address => uint8) internal _pricingSourceForAsset;
    mapping(address => address) internal _primaryPriceSourceForAsset;
    mapping(address => uint32) internal _maxStalenessForAsset;
    mapping(address => bool) internal _pricingConfiguredForAsset;
    AssetPricingConfig[] internal _pendingPricingConfigs;
    mapping(address => uint32) internal _primaryMaxStalenessForAsset;
    mapping(address => address) internal _quoteTokenForAsset;

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    modifier onlyInitialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    modifier onlyTradeAuthority() {
        if (!authorizedExecutor[msg.sender]) {
            revert NotTradeAuthority();
        }
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    function _protocolMinTargetWeightBps() internal view returns (uint16) {
        return IProtocolPortfolioLimits(factory).minTargetWeightBps();
    }

    function _protocolOtfTokenURI() internal view returns (string memory) {
        return IProtocolPortfolioLimits(factory).otfTokenURI();
    }

    function _isRetiringAsset(address asset) internal view returns (bool) {
        return targetWeightBps[asset] == 0;
    }

    function _effectiveTargetWeights() internal view returns (uint256[] memory weights) {
        uint256 length = _assets.length;
        weights = new uint256[](length);
        uint256 storedWeightTotal;

        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 storedWeight = targetWeightBps[asset];
            storedWeightTotal += storedWeight;
            weights[i] = storedWeight;
        }

        if (storedWeightTotal != 0 && storedWeightTotal != BPS) {
            revert InvalidWeightSum(storedWeightTotal);
        }
    }

    function _retiringBalancesAreWithinDust() internal view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (
                _isRetiringAsset(asset)
                    && IERC20(asset).balanceOf(address(this)) > MAX_RETIRING_DUST
            ) {
                return false;
            }
        }
        return true;
    }

    function _trackedAssetBalances() internal view returns (uint256[] memory balances) {
        balances = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            balances[i] = IERC20(_assets[i]).balanceOf(address(this));
        }
    }

    function _retiringBalancesImproved(uint256[] memory balancesBefore)
        internal
        view
        returns (bool improved)
    {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (!_isRetiringAsset(_assets[i])) continue;
            uint256 balanceAfter = IERC20(_assets[i]).balanceOf(address(this));
            if (balanceAfter > balancesBefore[i]) return false;
            if (balanceAfter < balancesBefore[i]) improved = true;
        }
    }

    function _retiringBreaches() internal view returns (address[] memory breached) {
        uint256 count;
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (
                _isRetiringAsset(asset)
                    && IERC20(asset).balanceOf(address(this)) > MAX_RETIRING_DUST
            ) count++;
        }
        breached = new address[](count);
        uint256 cursor;
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (
                _isRetiringAsset(asset)
                    && IERC20(asset).balanceOf(address(this)) > MAX_RETIRING_DUST
            ) {
                breached[cursor++] = asset;
            }
        }
    }

    function _startChallenge(address caller, address[] memory breached) internal {
        uint64 startedAt = uint64(block.timestamp);
        challengeActive = true;
        challengeCaller = caller;
        challengeStartedAt = startedAt;
        challengeDeadline = startedAt + CHALLENGE_GRACE_PERIOD;
        _feeState = FeeState.Escrowed;
        _challengeFeeAccrualRemainderWad = 0;
        emit OutOfBandChallengeStarted(caller, startedAt, challengeDeadline, breached);
    }

    function _pruneRetiringAssetsWithinDust() internal returns (uint256 removed) {
        uint256 length = _assets.length;

        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            if (
                _isRetiringAsset(asset)
                    && IERC20(asset).balanceOf(address(this)) <= MAX_RETIRING_DUST
            ) {
                removed++;
            }
        }
        if (removed == 0) return 0;
        removed = 0;

        uint256 writeIndex;
        uint256 remainingWeightTotal;

        for (uint256 readIndex = 0; readIndex < length; readIndex++) {
            address asset = _assets[readIndex];
            uint256 balance = IERC20(asset).balanceOf(address(this));
            if (_isRetiringAsset(asset) && balance <= MAX_RETIRING_DUST) {
                delete targetWeightBps[asset];
                IManagedOTFVaultAssetCleanup(address(this)).moduleClearAssetPricing(asset);
                removed++;
                if (balance != 0) emit RetiringDustWrittenOff(asset, balance);
                emit ConstituentRemoved(asset);
                continue;
            }

            remainingWeightTotal += targetWeightBps[asset];
            if (writeIndex != readIndex) _assets[writeIndex] = asset;
            writeIndex++;
        }

        while (_assets.length > writeIndex) _assets.pop();
        if (remainingWeightTotal != 0 && remainingWeightTotal != BPS) {
            revert InvalidWeightSum(remainingWeightTotal);
        }
    }
}
