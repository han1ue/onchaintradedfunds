// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { AssetStatus, IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { RebalanceExecutor } from "./RebalanceExecutor.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import {
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord,
    TradeInstruction
} from "./VaultTypes.sol";

interface IManagedOTFVaultModuleCallbacks {
    function moduleAccrueFees() external returns (uint256);
    function moduleMintFees(uint256 elapsed) external returns (uint256);
    function moduleReleaseChallengeFees() external returns (uint256);
}

interface IRegisteredRouteAdapter {
    function marketIdFromData(bytes calldata data) external pure returns (bytes32 marketId);
}

contract ManagedOTFVaultStrategy is ManagedOTFVaultStorage {
    using MathEx for uint256;
    using SafeTransferLib for address;

    PortfolioCalculator private immutable _calculator;
    address private immutable _self;
    uint256 private constant WEIGHT_PRECISION_SCALE = 1e12;

    constructor(PortfolioCalculator calculator_) {
        _calculator = calculator_;
        _self = address(this);
    }

    modifier onlyDelegateCall() {
        if (address(this) == _self) revert DirectStrategyCall();
        _;
    }

    function transfer(address, uint256) external pure override returns (bool) {
        revert DirectStrategyCall();
    }

    function approve(address, uint256) external pure override returns (bool) {
        revert DirectStrategyCall();
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        revert DirectStrategyCall();
    }

    function transferOwnership(address newOwner)
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
    {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == address(this)) revert InvalidRoleAddress(newOwner);
        _accrueViaVault();

        address oldManager = manager;
        if (strategyProposalPending) {
            _clearPendingStrategy();
            emit TargetWeightsProposalCancelled(rebalanceCount, oldManager);
        }
        delete _nextStrategyRationale;
        _clearExecutors();
        manager = newOwner;
        authorizedExecutor[newOwner] = true;
        _authorizedExecutors.push(newOwner);
        _executorIndexPlusOne[newOwner] = 1;
        emit OwnershipTransferred(oldManager, newOwner);
        emit ManagerTransferred(oldManager, newOwner);
    }

    function setFeeRecipient(address newFeeRecipient)
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
    {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        if (newFeeRecipient == address(this)) revert InvalidRoleAddress(newFeeRecipient);
        _accrueViaVault();
        address oldRecipient = feeRecipient;
        feeRecipient = newFeeRecipient;
        emit FeeRecipientTransferred(oldRecipient, newFeeRecipient);
    }

    function claimChallengeReward()
        external
        onlyDelegateCall
        nonReentrant
        returns (uint256 rewardShares)
    {
        rewardShares = challengeRewardShares[msg.sender];
        if (challengeActive || rewardShares != 0) {
            // Checkpoint the pre-mint supply and atomically process any overdue challenge.
            _accrueViaVault();
            rewardShares = challengeRewardShares[msg.sender];
        }
        challengeRewardShares[msg.sender] = 0;
        if (rewardShares != 0) _transfer(address(this), msg.sender, rewardShares);
        emit ChallengeRewardClaimed(msg.sender, rewardShares);
    }

    function accrueFees()
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
        returns (uint256 feeShares)
    {
        feeShares = _withdrawManagerFees();
    }

    function withdrawManagerFees()
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
        returns (uint256 feeShares)
    {
        feeShares = _withdrawManagerFees();
    }

    function setNextStrategyRationale(string calldata rationale)
        external
        onlyDelegateCall
        onlyManager
    {
        if (sunset) revert VaultSunset();
        if (challengeActive || strategicRebalanceActive || strategyProposalPending) {
            revert StrategyStateLocked();
        }
        _validateRationale(rationale);
        _nextStrategyRationale = rationale;
    }

    function setManagerFeeBps(uint16 newFeeBps) external onlyDelegateCall onlyManager nonReentrant {
        if (sunset) revert VaultSunset();
        if (newFeeBps > MAX_MANAGER_FEE_BPS_PER_YEAR) {
            revert ManagerFeeTooHigh(newFeeBps, MAX_MANAGER_FEE_BPS_PER_YEAR);
        }
        if (challengeActive || strategicRebalanceActive || strategyProposalPending) {
            revert StrategyStateLocked();
        }
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();
        _accrueViaVault();
        uint16 oldFeeBps = creatorFeeBpsPerYear;
        creatorFeeBpsPerYear = newFeeBps;
        emit ManagerFeeRateChanged(oldFeeBps, newFeeBps);
    }

    function setExecutor(address executor, bool authorized) external onlyDelegateCall onlyManager {
        if (executor == address(0) || executor == address(this)) {
            revert InvalidRoleAddress(executor);
        }
        if (authorized) {
            if (authorizedExecutor[executor]) revert ExecutorAlreadyAuthorized(executor);
            if (_authorizedExecutors.length >= MAX_AUTHORIZED_EXECUTORS) {
                revert ExecutorLimitReached();
            }
            authorizedExecutor[executor] = true;
            _authorizedExecutors.push(executor);
            _executorIndexPlusOne[executor] = _authorizedExecutors.length;
        } else {
            if (!authorizedExecutor[executor]) revert ExecutorNotAuthorized(executor);
            uint256 index = _executorIndexPlusOne[executor] - 1;
            uint256 lastIndex = _authorizedExecutors.length - 1;
            if (index != lastIndex) {
                address moved = _authorizedExecutors[lastIndex];
                _authorizedExecutors[index] = moved;
                _executorIndexPlusOne[moved] = index + 1;
            }
            _authorizedExecutors.pop();
            delete _executorIndexPlusOne[executor];
            authorizedExecutor[executor] = false;
        }
        emit ExecutorAuthorizationChanged(executor, authorized);
    }

    function setWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps_)
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
    {
        if (sunset) revert VaultSunset();
        if (challengeActive || strategicRebalanceActive || strategyProposalPending) {
            revert StrategyStateLocked();
        }
        uint256 nextAllowed = uint256(lastCompletedStrategyTimestamp) + STRATEGY_CHANGE_COOLDOWN;
        // Validator timestamp drift is immaterial to the configured multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAllowed) revert StrategyChangeCooldownActive(nextAllowed);
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();
        _validateWeightBands(completionDeviationBps, challengeDeviationBps_);
        _accrueViaVault();
        maxWeightDeviationBps = completionDeviationBps;
        challengeWeightDeviationBps = challengeDeviationBps_;
        if (!_isWithinBands(completionDeviationBps)) revert TargetBandsNotReached();
        emit WeightBandsUpdated(completionDeviationBps, challengeDeviationBps_);
    }

    function rebalance(address[] calldata newTokens, uint256[] calldata newWeights)
        external
        onlyDelegateCall
        onlyManager
        nonReentrant
    {
        string memory rationale = _nextStrategyRationale;
        if (bytes(rationale).length == 0) revert StrategyRationaleRequired();
        delete _nextStrategyRationale;
        _proposeStrategy(newTokens, newWeights, _marketIdsFor(newTokens), rationale);
    }

    function proposeStrategy(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        string calldata rationale
    ) external onlyDelegateCall onlyManager nonReentrant {
        delete _nextStrategyRationale;
        _proposeStrategy(newTokens, newWeights, _marketIdsFor(newTokens), rationale);
    }

    function proposeStrategyWithMarkets(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        bytes32[] calldata marketIds,
        string calldata rationale
    ) external onlyDelegateCall onlyManager nonReentrant {
        delete _nextStrategyRationale;
        _proposeStrategy(newTokens, newWeights, marketIds, rationale);
    }

    function _proposeStrategy(
        address[] memory newTokens,
        uint256[] memory newWeights,
        bytes32[] memory marketIds,
        string memory rationale
    ) private {
        if (sunset) revert VaultSunset();
        if (strategyProposalPending) revert PendingStrategyExists();
        if (challengeActive || strategicRebalanceActive) revert StrategyStateLocked();
        uint256 nextAllowed = uint256(lastCompletedStrategyTimestamp) + STRATEGY_CHANGE_COOLDOWN;
        // Validator timestamp drift is immaterial to the configured multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAllowed) revert StrategyChangeCooldownActive(nextAllowed);
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();

        _validateAndPinMarkets(newTokens, marketIds);
        _validatePortfolio(newTokens, newWeights);
        _validateRationale(rationale);
        if (!_targetsChanged(newTokens, newWeights)) revert StrategyTargetsUnchanged();

        uint64 proposedAt = uint64(block.timestamp);
        strategyProposalPending = true;
        pendingStrategyProposedAt = proposedAt;
        // The fixed 48-hour delay is far below uint64.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        pendingStrategyActivationTime = proposedAt + uint64(STRATEGY_ACTIVATION_DELAY);
        for (uint256 i = 0; i < newTokens.length; i++) {
            _pendingAssets.push(newTokens[i]);
            _pendingTargetWeightsBps.push(uint16(newWeights[i]));
            _pendingMarketIds.push(marketIds[i]);
        }
        _pendingStrategyRationale = rationale;

        emit TargetWeightsProposed(
            rebalanceCount,
            msg.sender,
            newTokens,
            newWeights,
            maxWeightDeviationBps,
            challengeWeightDeviationBps,
            proposedAt
        );
        emit StrategyRationaleLocked(_strategyVersions.length, msg.sender, rationale);
    }

    function activatePendingStrategy() external onlyDelegateCall onlyManager nonReentrant {
        if (sunset) revert VaultSunset();
        if (!strategyProposalPending) revert NoPendingStrategy();
        // The notice period is enforced by chain time so holders receive the full exit window.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < pendingStrategyActivationTime) {
            revert StrategyActivationPending(pendingStrategyActivationTime);
        }
        if (challengeActive || strategicRebalanceActive) {
            revert StrategyStateLocked();
        }
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();

        _validatePendingPortfolio();
        _accrueViaVault();

        address[] memory newTokens = _pendingAssets;
        uint256[] memory newWeights = _pendingWeightsAsUint256();
        (uint256[] memory currentWeights, uint256 navBefore) = _currentPreciseWeightsAndNav();
        uint256 turnover = _calculator.turnoverBps(
            _assets, newTokens, newWeights, currentWeights, WEIGHT_PRECISION_SCALE
        );

        uint64 activatedAt = uint64(block.timestamp);
        uint256 strategyVersion = _strategyVersions.length;
        uint64 proposedAt = pendingStrategyProposedAt;
        string memory rationale = _pendingStrategyRationale;
        _strategicNavPerShareBefore = MathEx.mulDiv(navBefore, 1e18, totalSupply);
        _strategicExecutionLossBps = 0;
        // Factory bounds cap turnover at BPS, well below uint16.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        _strategicTurnoverBps = uint16(turnover);
        strategicRebalanceStartedAt = activatedAt;
        strategicRebalanceActive = true;
        _replacePortfolio(newTokens, newWeights);
        _strategyVersions.push(
            StrategyVersion({
                proposedAt: proposedAt,
                activatedAt: activatedAt,
                completedAt: 0,
                author: msg.sender,
                rationale: rationale
            })
        );
        for (uint256 i = 0; i < newTokens.length; i++) {
            _strategyAssets[strategyVersion].push(newTokens[i]);
            _strategyTargetWeightsBps[strategyVersion].push(uint16(newWeights[i]));
        }
        _clearPendingStrategy();

        emit Rebalanced(newTokens, newWeights);
        emit TargetWeightsActivated(rebalanceCount, msg.sender, newTokens, newWeights, activatedAt);
        emit StrategyVersionActivated(
            strategyVersion, msg.sender, proposedAt, activatedAt, rationale
        );
    }

    function cancelPendingStrategy() external onlyDelegateCall onlyManager {
        if (sunset) revert VaultSunset();
        if (!strategyProposalPending) revert NoPendingStrategy();
        uint256 rebalanceId = rebalanceCount;
        _clearPendingStrategy();
        emit TargetWeightsProposalCancelled(rebalanceId, msg.sender);
    }

    function pruneRetiredAssets()
        external
        onlyDelegateCall
        onlyInitialized
        nonReentrant
        returns (uint256 removed)
    {
        removed = _pruneRetiringAssetsWithinDust();
        if (!sunset && !_hasActiveConstituent()) _enterTerminalShutdown();
    }

    function executeRebalanceTrades(TradeInstruction[] calldata trades)
        external
        onlyDelegateCall
        onlyTradeAuthority
        nonReentrant
    {
        if (sunset) revert VaultSunset();
        if (trades.length == 0 || trades.length > MAX_TRADE_COUNT) {
            revert TooManyTrades(trades.length, MAX_TRADE_COUNT);
        }
        _requireManagedAssetsAllowed();
        _accrueViaVault();

        (uint256[] memory weightsBefore, uint256 navBefore) = _currentPreciseWeightsAndNav();
        uint256[] memory balancesBefore = _trackedAssetBalances();
        address settlementAsset;
        uint256 settlementBalanceBefore;
        if (_assetMarketRegistry != address(0)) {
            settlementAsset = IAssetMarketRegistry(_assetMarketRegistry).usdg();
            settlementBalanceBefore = IERC20(settlementAsset).balanceOf(address(this));
        }
        uint256 distanceBefore = _distanceFromTarget(weightsBefore, WEIGHT_PRECISION_SCALE);
        uint256 grossLossValue;

        for (uint256 i = 0; i < trades.length; i++) {
            TradeInstruction calldata trade = trades[i];
            _validateTrade(trade);
            uint256 amountIn = trade.amountIn;
            if (amountIn == type(uint256).max) {
                if (!_isRetiringAsset(trade.tokenIn)) {
                    revert BadTrade(trade.tokenIn, trade.tokenOut, amountIn);
                }
                amountIn = IERC20(trade.tokenIn).balanceOf(address(this));
                if (amountIn == 0) revert BadTrade(trade.tokenIn, trade.tokenOut, amountIn);
            }
            uint256 valueIn = _assetValue(trade.tokenIn, amountIn);
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);
            trade.tokenIn.safeApprove(rebalanceExecutor, amountIn);
            uint256 amountOut = RebalanceExecutor(rebalanceExecutor).executeTrade(trade, amountIn);
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);

            uint256 valueOut = _assetValue(trade.tokenOut, amountOut);
            if (valueIn > valueOut) grossLossValue += valueIn - valueOut;
            uint256 minimumValue = MathEx.mulDiv(valueIn, BPS - maxNavLossBps, BPS);
            if (valueOut < minimumValue) {
                revert OracleSlippageTooHigh(
                    trade.tokenIn, trade.tokenOut, valueIn, valueOut, maxNavLossBps
                );
            }
            emit MaintenanceTradeExecuted(
                msg.sender, trade.adapter, trade.tokenIn, trade.tokenOut, amountIn, amountOut
            );
        }

        if (settlementAsset != address(0)) {
            uint256 settlementBalanceAfter = IERC20(settlementAsset).balanceOf(address(this));
            if (settlementBalanceAfter < settlementBalanceBefore) {
                revert SettlementBalanceConsumed(
                    settlementAsset, settlementBalanceBefore, settlementBalanceAfter
                );
            }
        }

        (uint256[] memory weightsAfter, uint256 navAfter) = _currentPreciseWeightsAndNav();
        uint256 minimumNav = MathEx.mulDiv(navBefore, BPS - maxNavLossBps, BPS);
        if (navAfter < minimumNav) {
            revert NavLossTooHigh(navBefore, navAfter, maxNavLossBps);
        }
        uint256 distanceAfter = _distanceFromTarget(weightsAfter, WEIGHT_PRECISION_SCALE);
        bool retiringBalancesImproved = _retiringBalancesImproved(balancesBefore);
        if (
            distanceAfter > distanceBefore
                || (distanceAfter == distanceBefore && !retiringBalancesImproved)
        ) {
            revert TradeDoesNotImproveTarget(distanceBefore, distanceAfter);
        }
        uint256[] memory effectiveTargets = _targetWeights();
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 target = effectiveTargets[i] * WEIGHT_PRECISION_SCALE;
            uint256 beforeDeviation = weightsBefore[i].absDiff(target);
            uint256 afterDeviation = weightsAfter[i].absDiff(target);
            if (afterDeviation > beforeDeviation) {
                revert AssetMovedAwayFromTarget(_assets[i], beforeDeviation, afterDeviation);
            }
        }

        uint256 netLossValue = navBefore > navAfter ? navBefore - navAfter : 0;
        uint256 lossValue = grossLossValue > netLossValue ? grossLossValue : netLossValue;
        uint256 batchLossBps = lossValue == 0 ? 0 : MathEx.mulDivUp(lossValue, BPS, navBefore);
        uint16 navLossBudgetUsedBps = _consumeNavLossBudget(batchLossBps);
        if (strategicRebalanceActive) {
            uint256 cumulativeStrategyLossBps = uint256(_strategicExecutionLossBps) + batchLossBps;
            // A uint32 cumulative counter cannot be exhausted within a strategy's lifetime.
            // forge-lint: disable-next-line(unsafe-typecast)
            _strategicExecutionLossBps = uint32(cumulativeStrategyLossBps);
        }

        uint256 executionId = tradeExecutionCount;
        uint256 currentStrategyVersion = _strategyVersions.length - 1;
        _recentTradeExecutions[executionId % RECENT_EXECUTION_CAP] = TradeExecutionRecord({
            timestamp: uint64(block.timestamp),
            executor: msg.sender,
            // A uint32 strategy counter cannot be exhausted within the chain's lifetime.
            // forge-lint: disable-next-line(unsafe-typecast)
            strategyVersion: uint32(currentStrategyVersion),
            navBefore: navBefore,
            navAfter: navAfter,
            // Both values were bounded by maxNavLossBps above.
            // forge-lint: disable-next-line(unsafe-typecast)
            batchLossBps: uint16(batchLossBps),
            navLossBudgetUsedBps: navLossBudgetUsedBps,
            tradeCount: uint16(trades.length)
        });
        tradeExecutionCount = executionId + 1;
        emit TradeExecutionRecorded(
            executionId,
            msg.sender,
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16(batchLossBps),
            navLossBudgetUsedBps,
            // A uint32 strategy counter cannot be exhausted within the chain's lifetime.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32(currentStrategyVersion)
        );

        if ((challengeActive || strategicRebalanceActive) && _isWithinBands(maxWeightDeviationBps))
        {
            if (challengeActive) {
                _resolveOutOfBandChallenge();
            } else {
                _completeStrategicRebalance();
                _resumeFeeClock();
            }
        }
        _pruneRetiringAssetsWithinDust();
    }

    function completeStrategicRebalance() external onlyDelegateCall nonReentrant {
        if (sunset) revert VaultSunset();
        if (!strategicRebalanceActive) revert StrategicRebalanceNotActive();
        if (challengeActive) {
            _resolveOutOfBandChallenge();
            return;
        }
        _accrueViaVault();
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();
        _completeStrategicRebalance();
        _resumeFeeClock();
    }

    function flagOutOfBand() external onlyDelegateCall nonReentrant {
        if (sunset) revert VaultSunset();
        _requireManagedAssetsAllowed();
        if (!_hasActiveConstituent()) {
            _enterTerminalShutdown();
            return;
        }
        if (challengeActive) revert ChallengeAlreadyActive();
        _accrueViaVault();
        address[] memory breached = _breachedAssets(challengeWeightDeviationBps);
        if (breached.length == 0) revert NoChallengeBreach();

        _startChallenge(msg.sender, breached);
    }

    function resolveOutOfBandChallenge() external onlyDelegateCall nonReentrant {
        _resolveOutOfBandChallenge();
    }

    function stopChallengeFees() external onlyDelegateCall onlyManager nonReentrant {
        if (sunset) revert VaultSunset();
        _resolveOutOfBandChallenge();
    }

    function finalizeTerminalShutdown() external onlyDelegateCall nonReentrant {
        if (sunset) revert VaultAlreadySunset();
        if (_hasActiveConstituent()) revert ActiveConstituentsRemain();
        _enterTerminalShutdown();
    }

    function sunsetOtf() external onlyDelegateCall onlyManager nonReentrant {
        if (sunset) revert VaultAlreadySunset();
        if (challengeActive || strategicRebalanceActive || strategyProposalPending) {
            revert StrategyStateLocked();
        }
        uint256 nextAllowedTime = uint256(lastCompletedStrategyTimestamp) + STRATEGY_CHANGE_COOLDOWN;
        // Sunset eligibility intentionally follows the same chain-time cooldown as strategy changes.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAllowedTime) {
            revert StrategyChangeCooldownActive(nextAllowedTime);
        }

        _accrueViaVault();
        delete _nextStrategyRationale;
        uint64 timestamp = uint64(block.timestamp);
        sunset = true;
        sunsetAt = timestamp;
        _feeState = FeeState.Sunset;
        emit OtfSunset(msg.sender, timestamp);
    }

    function _enterTerminalShutdown() private {
        // Challenge deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        bool beforeDeadline = challengeActive && block.timestamp <= challengeDeadline;

        _accrueViaVault();
        if (beforeDeadline) {
            IManagedOTFVaultModuleCallbacks(address(this)).moduleReleaseChallengeFees();
        }

        if (strategyProposalPending) {
            _clearPendingStrategy();
            emit TargetWeightsProposalCancelled(rebalanceCount, manager);
        }
        delete _nextStrategyRationale;

        // Freeze the terminal mandate at zero even if the registry later reapproves an asset.
        for (uint256 i = 0; i < _assets.length; i++) {
            delete targetWeightBps[_assets[i]];
        }

        challengeActive = false;
        challengeCaller = address(0);
        challengeStartedAt = 0;
        challengeDeadline = 0;
        strategicRebalanceActive = false;
        strategicRebalanceStartedAt = 0;
        _strategicExecutionLossBps = 0;

        uint64 timestamp = uint64(block.timestamp);
        sunset = true;
        sunsetAt = timestamp;
        _feeState = FeeState.Sunset;
        emit OtfSunset(msg.sender, timestamp);
    }

    function _resolveOutOfBandChallenge() private returns (uint256 releasedFeeShares) {
        if (!challengeActive) revert ChallengeNotActive();
        _accrueViaVault();
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();

        // forge-lint: disable-next-line(block-timestamp)
        bool timely = block.timestamp <= challengeDeadline;
        if (timely) {
            releasedFeeShares =
                IManagedOTFVaultModuleCallbacks(address(this)).moduleReleaseChallengeFees();
        }

        if (strategicRebalanceActive) {
            _completeStrategicRebalance();
        } else {
            _pruneRetiringAssetsWithinDust();
        }
        challengeActive = false;
        challengeCaller = address(0);
        challengeStartedAt = 0;
        challengeDeadline = 0;
        if (!timely) _resumeFeeClock();
        emit OutOfBandChallengeResolved(msg.sender, uint64(block.timestamp), timely);
    }

    function _completeStrategicRebalance() private {
        uint64 completedAt = uint64(block.timestamp);
        _pruneRetiringAssetsWithinDust();
        (uint256[] memory actualWeights, uint256 navAfter) = _currentWeightsAndNav();
        uint256 navPerShareAfter = MathEx.mulDiv(navAfter, 1e18, totalSupply);
        uint256 rebalanceId = rebalanceCount;
        uint256 strategyVersion = _strategyVersions.length - 1;
        _strategyVersions[strategyVersion].completedAt = completedAt;
        _recentRebalances[rebalanceId % RECENT_REBALANCE_CAP] = RebalanceRecord({
            timestamp: completedAt,
            manager: manager,
            navPerShareBefore: _strategicNavPerShareBefore,
            navPerShareAfter: navPerShareAfter,
            turnoverBps: _strategicTurnoverBps,
            executionLossBps: _strategicExecutionLossBps,
            // A uint32 strategy counter cannot be exhausted within the chain's lifetime.
            // forge-lint: disable-next-line(unsafe-typecast)
            strategyVersion: uint32(strategyVersion)
        });
        rebalanceCount = rebalanceId + 1;
        strategicRebalanceActive = false;
        strategicRebalanceStartedAt = 0;
        _strategicExecutionLossBps = 0;
        lastCompletedStrategyTimestamp = completedAt;
        emit StrategicRebalanceCompleted(rebalanceId, manager, completedAt, actualWeights);
        emit StrategyVersionCompleted(strategyVersion, completedAt);
    }

    function _resumeFeeClock() private {
        _feeState = FeeState.Accruing;
        lastFeeAccrualTimestamp = uint64(block.timestamp);
        emit ManagerFeeAccrualResumed(uint64(block.timestamp));
    }

    function _withdrawManagerFees() private returns (uint256 feeShares) {
        if (sunset) return _accrueViaVault();
        if (challengeActive) {
            feeShares = _accrueViaVault();
            // Challenge deadlines intentionally use chain time.
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp > challengeDeadline) return feeShares;
            if (!_isWithinBands(maxWeightDeviationBps)) return feeShares;
            return _resolveOutOfBandChallenge();
        }

        address[] memory breached = _breachedAssets(challengeWeightDeviationBps);
        if (breached.length == 0) return _accrueViaVault();
        feeShares = _accrueViaVault();
        _startChallenge(msg.sender, breached);
    }

    function _validateWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps_)
        private
        pure
    {
        if (
            completionDeviationBps == 0 || completionDeviationBps > MAX_COMPLETION_DEVIATION_BPS
                || challengeDeviationBps_ <= completionDeviationBps
                || challengeDeviationBps_ > MAX_BAND_DEVIATION_BPS
        ) {
            revert InvalidWeightBands(completionDeviationBps, challengeDeviationBps_);
        }
    }

    function _validateRationale(string memory rationale) private pure {
        uint256 length = bytes(rationale).length;
        if (length == 0) revert StrategyRationaleRequired();
        if (length > MAX_STRATEGY_RATIONALE_BYTES) revert StrategyRationaleTooLong(length);
    }

    function _targetsChanged(address[] memory newTokens, uint256[] memory newWeights)
        private
        view
        returns (bool)
    {
        if (newTokens.length != _assets.length) return true;
        for (uint256 i = 0; i < newTokens.length; i++) {
            if (!_containsCurrentAsset(newTokens[i])) return true;
            if (targetWeightBps[newTokens[i]] != newWeights[i]) return true;
        }
        return false;
    }

    function _validatePortfolio(address[] memory assets_, uint256[] memory weights_) private view {
        if (assets_.length != weights_.length) {
            revert LengthMismatch(assets_.length, weights_.length);
        }
        if (assets_.length == 0) revert EmptyPortfolio();
        uint256 minimumTargetWeightBps = _protocolMinTargetWeightBps();
        uint256 trackedCount = _assets.length;
        uint256 sum;
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            uint256 weight = weights_[i];
            if (asset == address(0)) revert ZeroAddress();
            if (asset.code.length == 0) revert AssetNotContract(asset);
            bool alreadyTracked = _containsCurrentAsset(asset);
            if (!alreadyTracked) {
                trackedCount += 1;
                if (trackedCount > MAX_TRACKED_ASSETS) revert TrackedAssetLimitExceeded();
            }
            if (!IAssetRegistry(assetRegistry).canBeConstituent(asset)) {
                if (!alreadyTracked || weight > targetWeightBps[asset]) {
                    revert UnapprovedAsset(asset);
                }
            }
            if (weight < minimumTargetWeightBps) {
                revert AssetWeightTooLow(asset, weight, minimumTargetWeightBps);
            }
            _requirePinnedMarketActive(asset);
            _calculator.validateAssetForVault(address(this), asset, oracleRegistry);
            for (uint256 j = i + 1; j < assets_.length; j++) {
                if (assets_[j] == asset) revert DuplicateConstituent(asset);
            }
            sum += weight;
        }
        if (sum != BPS) revert InvalidWeights(sum);
    }

    function _validatePendingPortfolio() private view {
        uint256[] memory weights = _pendingWeightsAsUint256();
        _validatePortfolio(_pendingAssets, weights);
    }

    function _validateTrade(TradeInstruction calldata trade) private view {
        if (trade.tokenIn == trade.tokenOut || trade.amountIn == 0) {
            revert BadTrade(trade.tokenIn, trade.tokenOut, trade.amountIn);
        }
        address registry = _assetMarketRegistry;
        address routeAsset;
        if (registry != address(0)) {
            address settlement = IAssetMarketRegistry(registry).usdg();
            bool inputIsSettlement = trade.tokenIn == settlement;
            bool outputIsSettlement = trade.tokenOut == settlement;
            if (inputIsSettlement == outputIsSettlement) {
                revert BadTrade(trade.tokenIn, trade.tokenOut, trade.amountIn);
            }
            routeAsset = inputIsSettlement ? trade.tokenOut : trade.tokenIn;
            if (!_containsCurrentAsset(routeAsset)) revert TradeAssetNotTracked(routeAsset);
            if (
                inputIsSettlement
                    && !IAssetRegistry(assetRegistry).canBeConstituent(routeAsset)
            ) revert UnapprovedAsset(routeAsset);
        } else {
            if (!_containsCurrentAsset(trade.tokenIn)) {
                revert TradeAssetNotTracked(trade.tokenIn);
            }
            if (!_containsCurrentAsset(trade.tokenOut)) {
                revert TradeAssetNotTracked(trade.tokenOut);
            }
            if (!IAssetRegistry(assetRegistry).canBeConstituent(trade.tokenIn)) {
                revert UnapprovedAsset(trade.tokenIn);
            }
            if (!IAssetRegistry(assetRegistry).canBeConstituent(trade.tokenOut)) {
                revert UnapprovedAsset(trade.tokenOut);
            }
        }
        if (!IAdapterAllowlist(factory).isTradeAdapterApproved(trade.adapter)) {
            revert UnapprovedAdapter(trade.adapter);
        }
        address pinnedAsset = routeAsset;
        if (pinnedAsset == address(0)) {
            pinnedAsset = _marketIdForAsset[trade.tokenIn] != bytes32(0)
                ? trade.tokenIn
                : trade.tokenOut;
        }
        bytes32 pinnedMarketId = _marketIdForAsset[pinnedAsset];
        if (pinnedMarketId != bytes32(0)) {
            bytes32 suppliedMarketId;
            try IRegisteredRouteAdapter(trade.adapter).marketIdFromData(trade.adapterData) returns (
                bytes32 decodedMarketId
            ) {
                suppliedMarketId = decodedMarketId;
            } catch {
                revert InvalidAssetMarket(
                    pinnedAsset, bytes32(0)
                );
            }
            if (suppliedMarketId != pinnedMarketId) {
                revert AssetMarketAlreadyPinned(pinnedAsset, pinnedMarketId, suppliedMarketId);
            }
        }
        _requirePinnedMarketActive(pinnedAsset);
        _calculator.validateAssetForVault(address(this), trade.tokenIn, oracleRegistry);
        _calculator.validateAssetForVault(address(this), trade.tokenOut, oracleRegistry);
    }

    function _currentWeightsAndNav() private view returns (uint256[] memory weights, uint256 nav) {
        return _calculator.portfolioState(address(this), _assets, oracleRegistry);
    }

    function _currentPreciseWeightsAndNav()
        private
        view
        returns (uint256[] memory weights, uint256 nav)
    {
        return _calculator.precisePortfolioState(address(this), _assets, oracleRegistry);
    }

    function _isWithinBands(uint16 deviationBps) private view returns (bool) {
        if (!_retiringBalancesAreWithinDust()) return false;
        return _calculator.isWithinBands(
            address(this), _assets, _targetWeights(), oracleRegistry, deviationBps
        );
    }

    function _breachedAssets(uint16 deviationBps) private view returns (address[] memory) {
        address[] memory retiring = _retiringBreaches();
        if (retiring.length != 0) return retiring;
        return _calculator.breachedAssets(
            address(this), _assets, _targetWeights(), oracleRegistry, deviationBps
        );
    }

    function _distanceFromTarget(uint256[] memory weights, uint256 targetScale)
        private
        view
        returns (uint256 distance)
    {
        uint256[] memory targets = _targetWeights();
        for (uint256 i = 0; i < _assets.length; i++) {
            distance += weights[i].absDiff(targets[i] * targetScale);
        }
    }

    function _assetValue(address asset, uint256 rawBalance) private view returns (uint256) {
        return _calculator.assetValueForVault(address(this), asset, rawBalance, oracleRegistry);
    }

    function _replacePortfolio(address[] memory assets_, uint256[] memory weights_) private {
        address[] memory previousAssets = _assets;
        delete _assets;

        for (uint256 i = 0; i < assets_.length; i++) {
            _assets.push(assets_[i]);
            targetWeightBps[assets_[i]] = uint16(weights_[i]);
        }
        for (uint256 i = 0; i < previousAssets.length; i++) {
            address asset = previousAssets[i];
            if (!_contains(assets_, asset)) {
                _assets.push(asset);
                targetWeightBps[asset] = 0;
            }
        }
    }

    function _pendingWeightsAsUint256() private view returns (uint256[] memory weights) {
        weights = new uint256[](_pendingTargetWeightsBps.length);
        for (uint256 i = 0; i < weights.length; i++) {
            weights[i] = _pendingTargetWeightsBps[i];
        }
    }

    function _clearPendingStrategy() private {
        delete _pendingAssets;
        delete _pendingTargetWeightsBps;
        delete _pendingMarketIds;
        delete _pendingStrategyRationale;
        strategyProposalPending = false;
        pendingStrategyProposedAt = 0;
        pendingStrategyActivationTime = 0;
    }

    function _marketIdsFor(address[] memory assets_) private view returns (bytes32[] memory ids) {
        ids = new bytes32[](assets_.length);
        for (uint256 i = 0; i < assets_.length; i++) {
            ids[i] = _marketIdForAsset[assets_[i]];
        }
    }

    function _validateAndPinMarkets(address[] memory assets_, bytes32[] memory marketIds_)
        private
    {
        if (assets_.length != marketIds_.length) {
            revert LengthMismatch(assets_.length, marketIds_.length);
        }
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            bytes32 marketId = marketIds_[i];
            AssetStatus status = IAssetRegistry(assetRegistry).statusOf(asset);
            if (status == AssetStatus.Qualified && marketId == bytes32(0)) continue;
            if (status != AssetStatus.Open && status != AssetStatus.Qualified) {
                revert UnapprovedAsset(asset);
            }
            if (marketId == bytes32(0)) revert InvalidAssetMarket(asset, marketId);
            address registry = _assetMarketRegistry;
            if (registry == address(0)) revert AssetMarketRegistryNotConfigured();
            bytes32 currentMarketId = _marketIdForAsset[asset];
            if (currentMarketId != bytes32(0) && currentMarketId != marketId) {
                revert AssetMarketAlreadyPinned(asset, currentMarketId, marketId);
            }
            (address marketAsset,, address priceFeed,, bool active) =
                IAssetMarketRegistry(registry).marketFor(marketId);
            if (!active || marketAsset != asset || priceFeed.code.length == 0) {
                revert InvalidAssetMarket(asset, marketId);
            }
            _marketIdForAsset[asset] = marketId;
            _priceFeedForAsset[asset] = priceFeed;
        }
    }

    function _requirePinnedMarketActive(address asset) private view {
        if (!IAssetRegistry(assetRegistry).canBeConstituent(asset)) {
            revert UnapprovedAsset(asset);
        }
        bytes32 marketId = _marketIdForAsset[asset];
        if (marketId == bytes32(0)) {
            if (IAssetRegistry(assetRegistry).statusOf(asset) == AssetStatus.Open) {
                revert InvalidAssetMarket(asset, marketId);
            }
            return;
        }
        address registry = _assetMarketRegistry;
        if (
            registry == address(0)
                || !IAssetMarketRegistry(registry).isActiveMarketForAsset(marketId, asset)
        ) {
            revert InvalidAssetMarket(asset, marketId);
        }
    }

    function _requireManagedAssetsAllowed() private view {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (!IAssetRegistry(assetRegistry).canBeConstituent(_assets[i])) {
                revert UnapprovedAsset(_assets[i]);
            }
        }
    }

    function _clearExecutors() private {
        for (uint256 i = 0; i < _authorizedExecutors.length; i++) {
            address executor = _authorizedExecutors[i];
            delete authorizedExecutor[executor];
            delete _executorIndexPlusOne[executor];
        }
        delete _authorizedExecutors;
    }

    function _targetWeights() private view returns (uint256[] memory weights) {
        return _effectiveTargetWeights();
    }

    function _consumeNavLossBudget(uint256 batchLossBps)
        private
        returns (uint16 usedLossBps)
    {
        uint256 packedState = _calculator.navLossBudgetState(
            _navLossBucketRecoveryAt, maxNavLossBps, batchLossBps
        );
        // Every packed value is bounded by the calculator before encoding.
        // forge-lint: disable-next-line(unsafe-typecast)
        usedLossBps = uint16(packedState);
        // forge-lint: disable-next-line(unsafe-typecast)
        _navLossBucketRecoveryAt = uint64(packedState >> 16);
    }

    function _contains(address[] memory assets_, address asset) private pure returns (bool) {
        for (uint256 i = 0; i < assets_.length; i++) {
            if (assets_[i] == asset) return true;
        }
        return false;
    }

    function _containsCurrentAsset(address asset) private view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
    }

    function _accrueViaVault() private returns (uint256 feeShares) {
        feeShares = IManagedOTFVaultModuleCallbacks(address(this)).moduleAccrueFees();
    }
}
