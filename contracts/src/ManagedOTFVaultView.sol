// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IProtocolPortfolioLimits } from "./ManagedOTFVaultStorage.sol";
import { ManagedOTFVaultModule } from "./ManagedOTFVaultModule.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    PricingSource,
    PinnedAssetPricing,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord
} from "./VaultTypes.sol";

/// @notice Read-only extension used by ManagedOTFVault through codehash-pinned delegatecall.
contract ManagedOTFVaultView is ManagedOTFVaultModule {
    PortfolioCalculator private immutable _portfolioCalculator;

    constructor(PortfolioCalculator portfolioCalculator_) {
        if (address(portfolioCalculator_).code.length == 0) {
            revert AssetNotContract(address(portfolioCalculator_));
        }
        _portfolioCalculator = portfolioCalculator_;
    }

    function assets() external view onlyDelegateCall returns (address[] memory) {
        return _assets;
    }

    function factory() external view onlyDelegateCall returns (address) {
        return _factory;
    }

    function manager() external view onlyDelegateCall returns (address) {
        return _manager;
    }

    function feeRecipient() external view onlyDelegateCall returns (address) {
        return _feeRecipient;
    }

    function feeCollector() external view onlyDelegateCall returns (address) {
        return _feeCollector;
    }

    function rebalanceExecutor() external view onlyDelegateCall returns (address) {
        return _rebalanceExecutor;
    }

    function managerFeeBpsPerYear() external view onlyDelegateCall returns (uint16) {
        return _managerFeeBpsPerYear;
    }

    function maxNavLossBps() external view onlyDelegateCall returns (uint16) {
        return _maxNavLossBps;
    }

    function maxWeightDeviationBps() external view onlyDelegateCall returns (uint16) {
        return _maxWeightDeviationBps;
    }

    function challengeWeightDeviationBps() external view onlyDelegateCall returns (uint16) {
        return _challengeWeightDeviationBps;
    }

    function lastFeeAccrualTimestamp() external view onlyDelegateCall returns (uint64) {
        return _lastFeeAccrualTimestamp;
    }

    function lastCompletedStrategyTimestamp() external view onlyDelegateCall returns (uint64) {
        return _lastCompletedStrategyTimestamp;
    }

    function pendingStrategyProposedAt() external view onlyDelegateCall returns (uint64) {
        uint64 activationTime = _pendingStrategyActivationTime;
        // The fixed delay fits uint64 and every nonzero activation timestamp includes it.
        // forge-lint: disable-next-line(unsafe-typecast)
        return activationTime == 0 ? 0 : activationTime - uint64(STRATEGY_ACTIVATION_DELAY);
    }

    function pendingStrategyActivationTime() external view onlyDelegateCall returns (uint64) {
        return _pendingStrategyActivationTime;
    }

    function rebalanceCount() external view onlyDelegateCall returns (uint256) {
        return _rebalanceCount;
    }

    function escrowedManagerFeeShares() external view onlyDelegateCall returns (uint256) {
        return _escrowedManagerFeeShares;
    }

    function forfeitedManagerFeeShares() external view onlyDelegateCall returns (uint256) {
        return _forfeitedManagerFeeShares;
    }

    function strategicRebalanceActive() external view onlyDelegateCall returns (bool) {
        return _strategicRebalanceIsActive();
    }

    function strategyProposalPending() external view onlyDelegateCall returns (bool) {
        return _strategyProposalIsPending();
    }

    function challengeActive() external view onlyDelegateCall returns (bool) {
        return _challengeIsActive();
    }

    function challengeCaller() external view onlyDelegateCall returns (address) {
        return _challengeCaller;
    }

    function challengeStartedAt() external view onlyDelegateCall returns (uint64) {
        return _challengeStartedAt;
    }

    function challengeDeadline() external view onlyDelegateCall returns (uint64) {
        return _challengeDeadline;
    }

    function targetWeightBps(address asset) external view onlyDelegateCall returns (uint16) {
        return _targetWeightBps[asset];
    }

    function authorizedExecutor(address executor) external view onlyDelegateCall returns (bool) {
        return _isAuthorizedExecutor(executor);
    }

    function challengeRewardShares(address account)
        external
        view
        onlyDelegateCall
        returns (uint256)
    {
        return _challengeRewardShares[account];
    }

    function sunset() external view onlyDelegateCall returns (bool) {
        return _sunset;
    }

    function sunsetAt() external view onlyDelegateCall returns (uint64) {
        return _sunsetAt;
    }

    function tradeExecutionCount() external view onlyDelegateCall returns (uint256) {
        return _tradeExecutionCount;
    }

    function pendingManager() external view onlyDelegateCall returns (address) {
        return _pendingManager;
    }

    function strategyVersionCount() external view onlyDelegateCall returns (uint256) {
        return _strategyVersions.length;
    }

    function getStrategyVersion(uint256 index)
        external
        view
        onlyDelegateCall
        returns (StrategyVersion memory)
    {
        return _strategyVersions[index];
    }

    function getStrategyTargets(uint256 index)
        external
        view
        onlyDelegateCall
        returns (address[] memory tokens, uint16[] memory weights)
    {
        tokens = _strategyAssets[index];
        weights = _strategyTargetWeightsBps[index];
    }

    function pendingStrategyRationale() external view onlyDelegateCall returns (string memory) {
        return _pendingStrategyRationale;
    }

    function nextStrategyRationale() external view onlyDelegateCall returns (string memory) {
        return _nextStrategyRationale;
    }

    function getConstituents()
        external
        view
        onlyDelegateCall
        returns (address[] memory tokens, uint256[] memory weights)
    {
        tokens = _assets;
        weights = _effectiveTargetWeights();
    }

    function totalConstituents() external view onlyDelegateCall returns (uint256 count) {
        count = _assets.length;
    }

    function getWeight(address token) external view onlyDelegateCall returns (uint256 weight) {
        if (!_containsAsset(token)) revert NotConstituent(token);
        uint256[] memory effectiveWeights = _effectiveTargetWeights();
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == token) return effectiveWeights[i];
        }
        revert NotConstituent(token);
    }

    function isConstituent(address token) external view onlyDelegateCall returns (bool) {
        return _containsAsset(token);
    }

    function getReserve(address token) external view onlyDelegateCall returns (uint256 balance) {
        if (!_containsAsset(token)) return 0;
        return IERC20(token).balanceOf(address(this));
    }

    function totalBasketValue() external view onlyDelegateCall returns (uint256 value) {
        return _portfolioCalculator.totalBasketValue(address(this), _assets);
    }

    function assetMarketRegistry() external view onlyDelegateCall returns (address) {
        return _assetMarketRegistry;
    }

    function pricingConfigForAsset(address asset)
        external
        view
        onlyDelegateCall
        returns (
            bool configured,
            PricingSource source,
            address quoteToken,
            address primarySource,
            address secondarySource,
            address normalizedPriceFeed,
            uint32 primaryMaxStaleness,
            uint32 secondaryMaxStaleness
        )
    {
        PinnedAssetPricing storage pinned = _pinnedPricingForAsset[asset];
        configured = pinned.normalizedPriceFeed != address(0);
        source = pinned.source;
        quoteToken = pinned.quoteToken;
        primarySource = pinned.primarySource;
        normalizedPriceFeed = pinned.normalizedPriceFeed;
        primaryMaxStaleness = pinned.primaryMaxStaleness;
        if (source == PricingSource.ChainlinkComposed || source == PricingSource.UniswapV3Twap) {
            (secondarySource, secondaryMaxStaleness,) =
                IAssetMarketRegistry(_assetMarketRegistry).quoteTokenConfig(quoteToken);
        }
    }

    function totalAssetsValue() external view onlyDelegateCall returns (uint256 nav) {
        return _portfolioCalculator.portfolioValue(address(this), _assets);
    }

    function navPerShare() external view onlyDelegateCall returns (uint256) {
        uint256 supply = _previewSupplyAfterAccrual();
        if (supply == 0) return 0;
        uint256 nav = _portfolioCalculator.portfolioValue(address(this), _assets);
        return Math.mulDiv(nav, 1e18, supply);
    }

    function currentWeightsBps() external view onlyDelegateCall returns (uint16[] memory weights) {
        (uint256[] memory current,) = _portfolioCalculator.portfolioState(address(this), _assets);
        weights = new uint16[](current.length);
        for (uint256 i = 0; i < current.length; i++) {
            weights[i] = uint16(current[i]);
        }
    }

    function currentWeight(address token) external view onlyDelegateCall returns (uint256 weight) {
        if (!_containsAsset(token)) revert NotConstituent(token);
        (uint256[] memory weights,) = _portfolioCalculator.portfolioState(address(this), _assets);
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == token) return weights[i];
        }
        revert NotConstituent(token);
    }

    function getWeightBands(address token)
        external
        view
        onlyDelegateCall
        returns (
            uint256 challengeLower,
            uint256 challengeUpper,
            uint256 completionLower,
            uint256 completionUpper
        )
    {
        if (!_containsAsset(token)) revert NotConstituent(token);
        if (_isRetiringAsset(token)) return (0, 0, 0, 0);
        uint256 target = _targetWeightBps[token];
        (challengeLower, challengeUpper) = _band(target, _challengeWeightDeviationBps);
        (completionLower, completionUpper) = _band(target, _maxWeightDeviationBps);
    }

    function isWithinTargetBands() external view onlyDelegateCall returns (bool) {
        return _isWithinBands(_maxWeightDeviationBps);
    }

    function isWithinChallengeBands() external view onlyDelegateCall returns (bool) {
        return _isWithinBands(_challengeWeightDeviationBps);
    }

    function canProposeStrategy() external view onlyDelegateCall returns (bool) {
        if (_sunset) return false;
        // Validator timestamp drift is immaterial to the fixed multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        bool cooldownActive = block.timestamp < _nextStrategyChangeTime();
        if (
            _challengeIsActive() || _strategicRebalanceIsActive() || _strategyProposalIsPending()
                || cooldownActive
        ) return false;
        return _isWithinBands(_maxWeightDeviationBps);
    }

    function challengeTimeRemaining() external view onlyDelegateCall returns (uint256) {
        // Challenge deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (!_challengeIsActive() || block.timestamp >= _challengeDeadline) return 0;
        return uint256(_challengeDeadline) - block.timestamp;
    }

    function nextStrategyChangeTime() external view onlyDelegateCall returns (uint256) {
        return _nextStrategyChangeTime();
    }

    function feeState() external view onlyDelegateCall returns (FeeState) {
        return _currentFeeState();
    }

    function authorizedExecutors()
        external
        view
        onlyDelegateCall
        returns (address[] memory executors)
    {
        return _authorizedExecutors;
    }

    function previewContribute(uint256[] calldata amounts)
        external
        view
        onlyDelegateCall
        returns (uint256 lpAmount)
    {
        if (amounts.length != _assets.length) {
            revert LengthMismatch(_assets.length, amounts.length);
        }
        _requireDepositsOpen();
        bool anyAmount;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] != 0) {
                anyAmount = true;
                break;
            }
        }
        if (!anyAmount) return 0;

        uint256 supply = _previewSupplyAfterAccrual();
        lpAmount = type(uint256).max;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            if (reserve == 0) {
                if (amounts[i] != 0) {
                    revert NonProportionalContribution(_assets[i], amounts[i], 0);
                }
                continue;
            }
            uint256 candidate = Math.mulDiv(amounts[i], supply, reserve);
            if (candidate < lpAmount) lpAmount = candidate;
        }
        if (lpAmount == type(uint256).max) return 0;

        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            uint256 required = Math.mulDiv(lpAmount, reserve, supply, Math.Rounding.Ceil);
            if (amounts[i] != required) {
                revert NonProportionalContribution(_assets[i], amounts[i], required);
            }
        }
    }

    function previewWithdraw(uint256 lpAmount)
        external
        view
        onlyDelegateCall
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](_assets.length);
        if (lpAmount == 0) return amounts;
        uint256 supply = _previewSupplyAfterAccrual();
        for (uint256 i = 0; i < _assets.length; i++) {
            amounts[i] = Math.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), lpAmount, supply);
        }
    }

    function previewMint(uint256 shares)
        external
        view
        onlyDelegateCall
        returns (uint256[] memory amountsIn)
    {
        if (shares == 0) revert ZeroShares();
        _requireDepositsOpen();
        uint256 supply = _previewSupplyAfterAccrual();
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            amountsIn[i] = Math.mulDiv(
                shares, IERC20(_assets[i]).balanceOf(address(this)), supply, Math.Rounding.Ceil
            );
        }
    }

    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        view
        onlyDelegateCall
        returns (uint256 shares, uint256[] memory amountsIn)
    {
        if (maxAmountsIn.length != _assets.length) {
            revert LengthMismatch(_assets.length, maxAmountsIn.length);
        }
        _requireDepositsOpen();
        uint256 supply = _previewSupplyAfterAccrual();
        shares = type(uint256).max;
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            if (reserve == 0) continue;
            uint256 candidate = Math.mulDiv(maxAmountsIn[i], supply, reserve);
            if (candidate < shares) shares = candidate;
        }
        if (shares == type(uint256).max || shares == 0) {
            shares = 0;
            return (shares, amountsIn);
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            amountsIn[i] = Math.mulDiv(
                shares, IERC20(_assets[i]).balanceOf(address(this)), supply, Math.Rounding.Ceil
            );
        }
    }

    function previewRedeem(uint256 shares)
        external
        view
        onlyDelegateCall
        returns (uint256[] memory amountsOut)
    {
        if (shares == 0) revert ZeroShares();
        amountsOut = new uint256[](_assets.length);
        uint256 supply = _previewSupplyAfterAccrual();
        for (uint256 i = 0; i < _assets.length; i++) {
            amountsOut[i] = Math.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), shares, supply);
        }
    }

    function recentRebalanceCount() external view onlyDelegateCall returns (uint256) {
        return _rebalanceCount < RECENT_REBALANCE_CAP ? _rebalanceCount : RECENT_REBALANCE_CAP;
    }

    function recentRebalanceRecord(uint256 index)
        external
        view
        onlyDelegateCall
        returns (RebalanceRecord memory)
    {
        uint256 storedCount = _rebalanceCount < RECENT_REBALANCE_CAP
            ? _rebalanceCount
            : RECENT_REBALANCE_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first =
            _rebalanceCount > RECENT_REBALANCE_CAP ? _rebalanceCount - RECENT_REBALANCE_CAP : 0;
        return _recentRebalances[(first + index) % RECENT_REBALANCE_CAP];
    }

    function navLossBudgetState()
        external
        view
        onlyDelegateCall
        returns (uint64 recoveryAt, uint16 usedLossBps, uint16 maximumLossBps)
    {
        // Bucket state is necessarily measured against chain time.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 timestamp = block.timestamp;
        uint256 storedRecoveryAt = _navLossBucketRecoveryAt;
        if (storedRecoveryAt > timestamp && _maxNavLossBps != 0) {
            uint256 used = Math.mulDiv(
                storedRecoveryAt - timestamp,
                _maxNavLossBps,
                NAV_LOSS_RECOVERY_PERIOD,
                Math.Rounding.Ceil
            );
            // Bucket usage cannot exceed the configured maximum of 200 BPS.
            // forge-lint: disable-next-line(unsafe-typecast)
            usedLossBps = uint16(used);
        }
        // Bucket recovery timestamps fit uint64 for the lifetime of the chain.
        // forge-lint: disable-next-line(unsafe-typecast)
        recoveryAt = uint64(storedRecoveryAt > timestamp ? storedRecoveryAt : timestamp);
        maximumLossBps = _maxNavLossBps;
    }

    function recentTradeExecutionCount() external view onlyDelegateCall returns (uint256) {
        return
            _tradeExecutionCount < RECENT_EXECUTION_CAP
                ? _tradeExecutionCount
                : RECENT_EXECUTION_CAP;
    }

    function recentTradeExecutionRecord(uint256 index)
        external
        view
        onlyDelegateCall
        returns (TradeExecutionRecord memory)
    {
        uint256 storedCount = _tradeExecutionCount < RECENT_EXECUTION_CAP
            ? _tradeExecutionCount
            : RECENT_EXECUTION_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first = _tradeExecutionCount > RECENT_EXECUTION_CAP
            ? _tradeExecutionCount - RECENT_EXECUTION_CAP
            : 0;
        return _recentTradeExecutions[(first + index) % RECENT_EXECUTION_CAP];
    }

    function _previewSupplyAfterAccrual() private view returns (uint256 supply) {
        supply = _totalSupply;
        if (_sunset) return supply;
        uint256 previousTimestamp = _lastFeeAccrualTimestamp;
        // Fee previews intentionally follow chain time, matching state-changing accrual.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= previousTimestamp) return supply;

        // forge-lint: disable-next-line(block-timestamp)
        bool challengeIsActive = _challengeIsActive();
        // Fee previews intentionally compare the current chain time with the onchain deadline.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 end = challengeIsActive && block.timestamp > _challengeDeadline
            ? uint256(_challengeDeadline)
            : block.timestamp;
        if (end <= previousTimestamp || _managerFeeBpsPerYear == 0) return supply;

        (uint256 feeShares,) = _portfolioCalculator.feeSharesAfterElapsed(
            _totalSupply,
            challengeIsActive ? _challengeFeeAccrualRemainderWad : _feeAccrualRemainderWad,
            _managerFeeBpsPerYear,
            end - previousTimestamp
        );
        // forge-lint: disable-next-line(block-timestamp)
        if (challengeIsActive && block.timestamp > _challengeDeadline) {
            // Existing escrowed shares are already included in _totalSupply. Forfeiture only
            // redistributes them between the challenge caller and treasury; it does not burn them.
            return supply + feeShares;
        }
        supply += feeShares;
    }

    function _requireDepositsOpen() private view {
        if (_sunset) revert VaultSunset();
        if (_assets.length == 0) revert EmptyPortfolio();
        if (IProtocolPortfolioLimits(_factory).depositsPaused()) revert ProtocolDepositsPaused();
        if (IProtocolPortfolioLimits(_factory).vaultDepositsPaused(address(this))) {
            revert VaultDepositsPaused();
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (_targetWeightBps[asset] == 0) revert DepositsPausedForRetiringAsset(asset);
        }
    }

    function _isWithinBands(uint16 deviationBps) private view returns (bool) {
        if (!_retiringBalancesAreWithinDust()) return false;
        uint256[] memory weights = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = _targetWeightBps[_assets[i]];
        }
        return _portfolioCalculator.isWithinBands(address(this), _assets, weights, deviationBps);
    }

    function _band(uint256 target, uint256 deviation)
        private
        pure
        returns (uint256 lower, uint256 upper)
    {
        lower = target > deviation ? target - deviation : 0;
        upper = target + deviation > BPS ? BPS : target + deviation;
    }

    function _nextStrategyChangeTime() private view returns (uint256) {
        return uint256(_lastCompletedStrategyTimestamp) + STRATEGY_CHANGE_COOLDOWN;
    }

    function _currentFeeState() private view returns (FeeState) {
        if (_sunset) return FeeState.Sunset;
        if (!_challengeIsActive()) return FeeState.Accruing;
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > _challengeDeadline ? FeeState.Suspended : FeeState.Escrowed;
    }

    function _containsAsset(address asset) private view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
    }
}
