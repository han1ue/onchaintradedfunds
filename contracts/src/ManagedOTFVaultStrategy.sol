// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { IERC20, IERC20Metadata } from "./interfaces/IERC20.sol";
import { RebalanceExecutor } from "./RebalanceExecutor.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import {
    AssetPricingConfig,
    PricingSource,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord,
    TradeInstruction
} from "./VaultTypes.sol";

interface IManagedOTFVaultModuleCallbacks {
    function moduleAccrueFees() external returns (uint256);
    function moduleMintFees(uint256 elapsed) external returns (uint256);
    function moduleReleaseChallengeFees() external returns (uint256);
    function modulePrepareAssetPricing(address asset, AssetPricingConfig calldata config) external;
    function modulePinAssetPricing(address asset, AssetPricingConfig calldata config) external;
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
        _proposeStrategy(newTokens, newWeights, _pricingConfigsFor(newTokens), rationale);
    }

    function proposeStrategy(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        string calldata rationale
    ) external onlyDelegateCall onlyManager nonReentrant {
        delete _nextStrategyRationale;
        _proposeStrategy(newTokens, newWeights, _pricingConfigsFor(newTokens), rationale);
    }

    function proposeStrategyWithPricing(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        AssetPricingConfig[] calldata pricingConfigs,
        string calldata rationale
    ) external onlyDelegateCall onlyManager nonReentrant {
        delete _nextStrategyRationale;
        _proposeStrategy(newTokens, newWeights, pricingConfigs, rationale);
    }

    function _proposeStrategy(
        address[] memory newTokens,
        uint256[] memory newWeights,
        AssetPricingConfig[] memory pricingConfigs,
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

        if (newTokens.length != pricingConfigs.length) {
            revert LengthMismatch(newTokens.length, pricingConfigs.length);
        }
        for (uint256 i = 0; i < newTokens.length; i++) {
            if (_pricingConfiguredForAsset[newTokens[i]]) {
                _requireMatchingPinnedPricing(newTokens[i], pricingConfigs[i]);
            } else {
                IManagedOTFVaultModuleCallbacks(address(this))
                    .modulePrepareAssetPricing(newTokens[i], pricingConfigs[i]);
            }
        }
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
            _pendingPricingConfigs.push(pricingConfigs[i]);
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

        for (uint256 i = 0; i < _pendingAssets.length; i++) {
            IManagedOTFVaultModuleCallbacks(address(this))
                .modulePinAssetPricing(_pendingAssets[i], _pendingPricingConfigs[i]);
        }

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
        _accrueViaVault();

        (uint256[] memory weightsBefore, uint256 navBefore) = _currentPreciseWeightsAndNav();
        uint256[] memory balancesBefore = _trackedAssetBalances();
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
            // Grant only the exact input allowance immediately before execution and clear it
            // afterward. The vault guard blocks callbacks, and a revert rolls back the allowance.
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
            if (asset == address(this)) revert SelfAssetNotSupported();
            if (asset.code.length == 0) revert AssetNotContract(asset);
            uint8 assetDecimals;
            try IERC20Metadata(asset).decimals() returns (uint8 decimals_) {
                assetDecimals = decimals_;
            } catch {
                revert TokenDecimalsUnavailable(asset);
            }
            if (assetDecimals != 18) revert UnsupportedDecimals(asset, assetDecimals);
            bool alreadyTracked = _containsCurrentAsset(asset);
            if (!alreadyTracked) {
                trackedCount += 1;
                if (trackedCount > MAX_TRACKED_ASSETS) revert TrackedAssetLimitExceeded();
            }
            if (weight < minimumTargetWeightBps) {
                revert AssetWeightTooLow(asset, weight, minimumTargetWeightBps);
            }
            if (_pricingConfiguredForAsset[asset]) {
                _calculator.validateAssetForVault(address(this), asset);
            }
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
        if (!_containsCurrentAsset(trade.tokenIn)) {
            revert TradeAssetNotTracked(trade.tokenIn);
        }
        if (!_containsCurrentAsset(trade.tokenOut)) {
            revert TradeAssetNotTracked(trade.tokenOut);
        }
        if (!IAdapterAllowlist(factory).isTradeAdapterApproved(trade.adapter)) {
            revert UnapprovedAdapter(trade.adapter);
        }
        _calculator.validateAssetForVault(address(this), trade.tokenIn);
        _calculator.validateAssetForVault(address(this), trade.tokenOut);
    }

    function _currentWeightsAndNav() private view returns (uint256[] memory weights, uint256 nav) {
        return _calculator.portfolioState(address(this), _assets);
    }

    function _currentPreciseWeightsAndNav()
        private
        view
        returns (uint256[] memory weights, uint256 nav)
    {
        return _calculator.precisePortfolioState(address(this), _assets);
    }

    function _isWithinBands(uint16 deviationBps) private view returns (bool) {
        if (!_retiringBalancesAreWithinDust()) return false;
        return _calculator.isWithinBands(address(this), _assets, _targetWeights(), deviationBps);
    }

    function _breachedAssets(uint16 deviationBps) private view returns (address[] memory) {
        address[] memory retiring = _retiringBreaches();
        if (retiring.length != 0) return retiring;
        return _calculator.breachedAssets(address(this), _assets, _targetWeights(), deviationBps);
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
        return _calculator.assetValueForVault(address(this), asset, rawBalance);
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
        delete _pendingPricingConfigs;
        delete _pendingStrategyRationale;
        strategyProposalPending = false;
        pendingStrategyProposedAt = 0;
        pendingStrategyActivationTime = 0;
    }

    function _pricingConfigsFor(address[] memory assets_)
        private
        view
        returns (AssetPricingConfig[] memory configs)
    {
        configs = new AssetPricingConfig[](assets_.length);
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            if (!_pricingConfiguredForAsset[asset]) continue;
            configs[i] = AssetPricingConfig({
                source: PricingSource(_pricingSourceForAsset[asset]),
                quoteToken: _quoteTokenForAsset[asset],
                primarySource: _primaryPriceSourceForAsset[asset],
                primaryMaxStaleness: _primaryMaxStalenessForAsset[asset]
            });
        }
    }

    function _requireMatchingPinnedPricing(address asset, AssetPricingConfig memory config)
        private
        view
    {
        if (
            config.primarySource != address(0)
                && (uint8(config.source) != _pricingSourceForAsset[asset]
                    || config.primarySource != _primaryPriceSourceForAsset[asset])
        ) {
            revert AssetPricingAlreadyPinned(asset);
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

    function _consumeNavLossBudget(uint256 batchLossBps) private returns (uint16 usedLossBps) {
        uint256 packedState =
            _calculator.navLossBudgetState(_navLossBucketRecoveryAt, maxNavLossBps, batchLossBps);
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
