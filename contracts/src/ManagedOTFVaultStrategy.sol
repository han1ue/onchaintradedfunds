// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { RebalanceExecutor } from "./RebalanceExecutor.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { RebalanceRecord, ThesisVersion, TradeInstruction } from "./VaultTypes.sol";

interface IManagedOTFVaultModuleCallbacks {
    function moduleAccrueFees() external returns (uint256);
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
            delete _pendingAssets;
            delete _pendingTargetWeightsBps;
            strategyProposalPending = false;
            pendingStrategyProposedAt = 0;
            pendingStrategyActivationTime = 0;
            emit TargetWeightsProposalCancelled(rebalanceCount, oldManager);
        }
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
        if (rewardShares != 0) _mint(msg.sender, rewardShares);
        emit ChallengeRewardClaimed(msg.sender, rewardShares);
    }

    function appendThesisAmendment(string calldata text) external onlyDelegateCall onlyManager {
        uint256 length = bytes(text).length;
        if (length > MAX_THESIS_BYTES) revert ThesisTooLong(length);
        uint256 version = _thesisVersions.length;
        uint64 timestamp = uint64(block.timestamp);
        bytes32 portfolioHash = _portfolioHashCurrent();
        _thesisVersions.push(
            ThesisVersion({
                timestamp: timestamp, author: msg.sender, portfolioHash: portfolioHash, text: text
            })
        );
        emit ThesisAmended(version, timestamp, msg.sender, portfolioHash, text);
    }

    function setManagerFeeBps(uint16 newFeeBps) external onlyDelegateCall onlyManager nonReentrant {
        if (newFeeBps > MAX_MANAGER_FEE_BPS_PER_YEAR) {
            revert ManagerFeeTooHigh(newFeeBps, MAX_MANAGER_FEE_BPS_PER_YEAR);
        }
        if (challengeActive || strategicRebalanceActive) revert StrategyStateLocked();
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
        if (challengeActive || strategicRebalanceActive) revert StrategyStateLocked();
        uint256 nextAllowed = uint256(lastRebalanceTimestamp) + uint256(rebalanceCooldown);
        // Validator timestamp drift is immaterial to the configured multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAllowed) revert RebalanceCooldownActive(nextAllowed);
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
        if (strategyProposalPending) revert PendingStrategyExists();
        if (challengeActive || strategicRebalanceActive) revert StrategyStateLocked();
        uint256 nextAllowed = uint256(lastRebalanceTimestamp) + uint256(rebalanceCooldown);
        uint256 nextStrategyAllowed =
            uint256(lastStrategyChangeTimestamp) + STRATEGY_CHANGE_COOLDOWN;
        // Validator timestamp drift is immaterial to the configured multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAllowed) revert RebalanceCooldownActive(nextAllowed);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextStrategyAllowed) {
            revert StrategyChangeCooldownActive(nextStrategyAllowed);
        }
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();

        _validatePortfolio(newTokens, newWeights);

        (uint256[] memory currentWeights,) = _currentPreciseWeightsAndNav();
        uint256 turnover =
            _turnoverBps(newTokens, newWeights, currentWeights, WEIGHT_PRECISION_SCALE);
        if (turnover > maxTurnoverBps) revert TurnoverTooHigh(turnover, maxTurnoverBps);

        uint64 proposedAt = uint64(block.timestamp);
        strategyProposalPending = true;
        pendingStrategyProposedAt = proposedAt;
        // The fixed 48-hour delay is far below uint64.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        pendingStrategyActivationTime = proposedAt + uint64(STRATEGY_ACTIVATION_DELAY);
        for (uint256 i = 0; i < newTokens.length; i++) {
            _pendingAssets.push(newTokens[i]);
            _pendingTargetWeightsBps.push(uint16(newWeights[i]));
        }

        emit TargetWeightsProposed(
            rebalanceCount,
            msg.sender,
            newTokens,
            newWeights,
            maxWeightDeviationBps,
            challengeWeightDeviationBps,
            proposedAt
        );
    }

    function activatePendingStrategy() external onlyDelegateCall onlyManager nonReentrant {
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
        uint256 turnover =
            _turnoverBps(newTokens, newWeights, currentWeights, WEIGHT_PRECISION_SCALE);
        if (turnover > maxTurnoverBps) revert TurnoverTooHigh(turnover, maxTurnoverBps);

        uint64 activatedAt = uint64(block.timestamp);
        _strategicOldPortfolioHash = _portfolioHashCurrent();
        _strategicNavBefore = navBefore;
        // Factory bounds cap turnover at BPS, well below uint16.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        _strategicTurnoverBps = uint16(turnover);
        strategicRebalanceStartedAt = activatedAt;
        strategicRebalanceActive = true;
        lastStrategyChangeTimestamp = activatedAt;
        _replacePortfolio(newTokens, newWeights);
        _clearPendingStrategy();

        emit Rebalanced(newTokens, newWeights);
        emit TargetWeightsActivated(
            rebalanceCount, msg.sender, newTokens, newWeights, activatedAt
        );
    }

    function cancelPendingStrategy() external onlyDelegateCall onlyManager {
        if (!strategyProposalPending) revert NoPendingStrategy();
        uint256 rebalanceId = rebalanceCount;
        _clearPendingStrategy();
        emit TargetWeightsProposalCancelled(rebalanceId, msg.sender);
    }

    function executeRebalanceTrades(TradeInstruction[] calldata trades)
        external
        onlyDelegateCall
        onlyTradeAuthority
        nonReentrant
    {
        if (trades.length == 0 || trades.length > MAX_TRADE_COUNT) {
            revert TooManyTrades(trades.length, MAX_TRADE_COUNT);
        }
        _accrueViaVault();

        (uint256[] memory weightsBefore, uint256 navBefore) = _currentPreciseWeightsAndNav();
        uint256 distanceBefore = _distanceFromTarget(weightsBefore, WEIGHT_PRECISION_SCALE);
        uint256 tradeValue;
        uint256[] memory valuesIn = new uint256[](trades.length);

        for (uint256 i = 0; i < trades.length; i++) {
            TradeInstruction calldata trade = trades[i];
            _validateTrade(trade);
            valuesIn[i] = _assetValue(trade.tokenIn, trade.amountIn);
            tradeValue += valuesIn[i];
        }
        uint256 turnover = MathEx.mulDiv(tradeValue, BPS, navBefore);
        if (turnover > maxTurnoverBps) revert TurnoverTooHigh(turnover, maxTurnoverBps);

        for (uint256 i = 0; i < trades.length; i++) {
            TradeInstruction calldata trade = trades[i];
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);
            trade.tokenIn.safeApprove(rebalanceExecutor, trade.amountIn);
            uint256 amountOut = RebalanceExecutor(rebalanceExecutor).executeTrade(trade);
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);

            uint256 valueOut = _assetValue(trade.tokenOut, amountOut);
            uint256 minimumValue = MathEx.mulDiv(valuesIn[i], BPS - maxNavLossBps, BPS);
            if (valueOut < minimumValue) {
                revert OracleSlippageTooHigh(
                    trade.tokenIn, trade.tokenOut, valuesIn[i], valueOut, maxNavLossBps
                );
            }
            emit MaintenanceTradeExecuted(
                msg.sender, trade.adapter, trade.tokenIn, trade.tokenOut, trade.amountIn, amountOut
            );
        }

        (uint256[] memory weightsAfter, uint256 navAfter) = _currentPreciseWeightsAndNav();
        uint256 minimumNav = MathEx.mulDiv(navBefore, BPS - maxNavLossBps, BPS);
        if (navAfter < minimumNav) {
            revert NavLossTooHigh(navBefore, navAfter, maxNavLossBps);
        }
        uint256 distanceAfter = _distanceFromTarget(weightsAfter, WEIGHT_PRECISION_SCALE);
        if (distanceAfter >= distanceBefore) {
            revert TradeDoesNotImproveTarget(distanceBefore, distanceAfter);
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 target = uint256(targetWeightBps[_assets[i]]) * WEIGHT_PRECISION_SCALE;
            uint256 beforeDeviation = weightsBefore[i].absDiff(target);
            uint256 afterDeviation = weightsAfter[i].absDiff(target);
            if (afterDeviation > beforeDeviation) {
                revert AssetMovedAwayFromTarget(_assets[i], beforeDeviation, afterDeviation);
            }
            uint256 maxWeight = uint256(maxSingleAssetWeightBps) * WEIGHT_PRECISION_SCALE;
            if (weightsAfter[i] > maxWeight && weightsAfter[i] > weightsBefore[i]) {
                revert ExposureLimitExceeded(
                    _assets[i], weightsBefore[i], weightsAfter[i], maxSingleAssetWeightBps
                );
            }
        }

        if (
            (challengeActive || strategicRebalanceActive)
                && _isWithinBands(maxWeightDeviationBps)
        ) {
            if (challengeActive) {
                _resolveOutOfBandChallenge();
            } else {
                _completeStrategicRebalance();
                _resumeFeeClock();
            }
        }
    }

    function completeStrategicRebalance() external onlyDelegateCall nonReentrant {
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
        if (challengeActive) revert ChallengeAlreadyActive();
        _accrueViaVault();
        address[] memory breached = _breachedAssets(challengeWeightDeviationBps);
        if (breached.length == 0) revert NoChallengeBreach();

        uint64 startedAt = uint64(block.timestamp);
        challengeActive = true;
        challengeCaller = msg.sender;
        challengeStartedAt = startedAt;
        challengeDeadline = startedAt + challengeGracePeriod;
        emit OutOfBandChallengeStarted(msg.sender, startedAt, challengeDeadline, breached);
    }

    function resolveOutOfBandChallenge() external onlyDelegateCall nonReentrant {
        _resolveOutOfBandChallenge();
    }

    function stopChallengeFees() external onlyDelegateCall onlyManager nonReentrant {
        _resolveOutOfBandChallenge();
    }

    function _resolveOutOfBandChallenge() private {
        if (!challengeActive) revert ChallengeNotActive();
        // Challenge deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > challengeDeadline) _accrueViaVault();
        if (!_isWithinBands(maxWeightDeviationBps)) revert TargetBandsNotReached();

        // forge-lint: disable-next-line(block-timestamp)
        bool timely = block.timestamp <= challengeDeadline;
        challengeActive = false;
        challengeCaller = address(0);
        challengeStartedAt = 0;
        challengeDeadline = 0;

        if (strategicRebalanceActive) _completeStrategicRebalance();
        if (timely) {
            _accrueViaVault();
        } else {
            _resumeFeeClock();
        }
        emit OutOfBandChallengeResolved(msg.sender, uint64(block.timestamp), timely);
    }

    function _completeStrategicRebalance() private {
        uint64 completedAt = uint64(block.timestamp);
        (uint256[] memory actualWeights, uint256 navAfter) = _currentWeightsAndNav();
        uint256 rebalanceId = rebalanceCount;
        _recentRebalances[rebalanceId % RECENT_REBALANCE_CAP] = RebalanceRecord({
            timestamp: completedAt,
            manager: manager,
            oldPortfolioHash: _strategicOldPortfolioHash,
            newPortfolioHash: _portfolioHashCurrent(),
            navBefore: _strategicNavBefore,
            navAfter: navAfter,
            turnoverBps: _strategicTurnoverBps,
            thesisVersion: uint32(_thesisVersions.length - 1)
        });
        rebalanceCount = rebalanceId + 1;
        strategicRebalanceActive = false;
        strategicRebalanceStartedAt = 0;
        lastRebalanceTimestamp = completedAt;
        lastCompletedStrategicRebalance = completedAt;
        emit StrategicRebalanceCompleted(rebalanceId, manager, completedAt, actualWeights);
    }

    function _resumeFeeClock() private {
        _feeState = FeeState.Accruing;
        lastFeeAccrualTimestamp = uint64(block.timestamp);
        emit ManagerFeeAccrualResumed(uint64(block.timestamp));
    }

    function _validateWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps_)
        private
        pure
    {
        if (
            completionDeviationBps == 0
                || completionDeviationBps > MAX_COMPLETION_DEVIATION_BPS
                || challengeDeviationBps_ <= completionDeviationBps
                || challengeDeviationBps_ > MAX_BAND_DEVIATION_BPS
        ) {
            revert InvalidWeightBands(completionDeviationBps, challengeDeviationBps_);
        }
    }

    function _validatePortfolio(address[] memory assets_, uint256[] memory weights_)
        private
        view
    {
        if (assets_.length != weights_.length) {
            revert LengthMismatch(assets_.length, weights_.length);
        }
        if (assets_.length == 0) revert EmptyPortfolio();
        if (assets_.length > maxAssetCount) {
            revert TooManyAssets(assets_.length, maxAssetCount);
        }
        uint256 sum;
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            uint256 weight = weights_[i];
            if (asset == address(0)) revert ZeroAddress();
            if (asset.code.length == 0) revert AssetNotContract(asset);
            if (!IAssetRegistry(assetRegistry).isApprovedAsset(asset)) {
                if (!_containsCurrentAsset(asset) || weight > targetWeightBps[asset]) {
                    revert UnapprovedAsset(asset);
                }
            }
            if (weight > maxSingleAssetWeightBps) {
                revert AssetWeightTooHigh(asset, weight, maxSingleAssetWeightBps);
            }
            if (weight < minNonZeroAssetWeightBps) {
                revert AssetWeightTooLow(asset, weight, minNonZeroAssetWeightBps);
            }
            _calculator.validateAsset(asset, oracleRegistry, maxOracleStaleness);
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
        if (!IAssetRegistry(assetRegistry).isApprovedAsset(trade.tokenOut)) {
            revert UnapprovedAsset(trade.tokenOut);
        }
        if (!IAdapterAllowlist(factory).isTradeAdapterApproved(trade.adapter)) {
            revert UnapprovedAdapter(trade.adapter);
        }
        _calculator.validateAsset(trade.tokenIn, oracleRegistry, maxOracleStaleness);
        _calculator.validateAsset(trade.tokenOut, oracleRegistry, maxOracleStaleness);
    }

    function _currentWeightsAndNav() private view returns (uint256[] memory weights, uint256 nav) {
        return
            _calculator.portfolioState(address(this), _assets, oracleRegistry, maxOracleStaleness);
    }

    function _currentPreciseWeightsAndNav()
        private
        view
        returns (uint256[] memory weights, uint256 nav)
    {
        return _calculator.precisePortfolioState(
            address(this), _assets, oracleRegistry, maxOracleStaleness
        );
    }

    function _isWithinBands(uint16 deviationBps) private view returns (bool) {
        return _calculator.isWithinBands(
            address(this),
            _assets,
            _targetWeights(),
            oracleRegistry,
            maxOracleStaleness,
            deviationBps
        );
    }

    function _breachedAssets(uint16 deviationBps) private view returns (address[] memory) {
        return _calculator.breachedAssets(
            address(this),
            _assets,
            _targetWeights(),
            oracleRegistry,
            maxOracleStaleness,
            deviationBps
        );
    }

    function _distanceFromTarget(uint256[] memory weights, uint256 targetScale)
        private
        view
        returns (uint256 distance)
    {
        for (uint256 i = 0; i < _assets.length; i++) {
            distance += weights[i].absDiff(uint256(targetWeightBps[_assets[i]]) * targetScale);
        }
    }

    function _turnoverBps(
        address[] memory newTokens,
        uint256[] memory newWeights,
        uint256[] memory currentWeights,
        uint256 targetScale
    ) private view returns (uint256) {
        uint256 sumDiff;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 targetWeight = _weightOf(newTokens, newWeights, _assets[i]) * targetScale;
            sumDiff += currentWeights[i].absDiff(targetWeight);
        }
        for (uint256 i = 0; i < newTokens.length; i++) {
            if (!_containsCurrentAsset(newTokens[i])) sumDiff += newWeights[i] * targetScale;
        }
        return MathEx.mulDivUp(sumDiff, 1, 2 * targetScale);
    }

    function _assetValue(address asset, uint256 rawBalance) private view returns (uint256) {
        return _calculator.assetValue(asset, rawBalance, oracleRegistry, maxOracleStaleness);
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
        strategyProposalPending = false;
        pendingStrategyProposedAt = 0;
        pendingStrategyActivationTime = 0;
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
        weights = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
        }
    }

    function _portfolioHashCurrent() private view returns (bytes32) {
        return keccak256(abi.encode(_assets, _targetWeights()));
    }

    function _weightOf(address[] memory assets_, uint256[] memory weights_, address asset)
        private
        pure
        returns (uint256)
    {
        for (uint256 i = 0; i < assets_.length; i++) {
            if (assets_[i] == asset) return weights_[i];
        }
        return 0;
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

    function _accrueViaVault() private {
        IManagedOTFVaultModuleCallbacks(address(this)).moduleAccrueFees();
    }
}
