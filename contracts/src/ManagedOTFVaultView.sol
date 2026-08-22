// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IProtocolPortfolioLimits, ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { MathEx } from "./libraries/MathEx.sol";
import {
    PricingSource,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord
} from "./VaultTypes.sol";

/// @notice Read-only extension used by ManagedOTFVault through codehash-pinned delegatecall.
contract ManagedOTFVaultView is ManagedOTFVaultStorage {
    address private immutable _self;
    PortfolioCalculator private immutable _portfolioCalculator;

    constructor(PortfolioCalculator portfolioCalculator_) {
        if (address(portfolioCalculator_).code.length == 0) {
            revert AssetNotContract(address(portfolioCalculator_));
        }
        _self = address(this);
        _portfolioCalculator = portfolioCalculator_;
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

    function marketIdForAsset(address asset) external view onlyDelegateCall returns (bytes32) {
        return _marketIdForAsset[asset];
    }

    function priceFeedForAsset(address asset) external view onlyDelegateCall returns (address) {
        return _priceFeedForAsset[asset];
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
        configured = _pricingConfiguredForAsset[asset];
        source = PricingSource(_pricingSourceForAsset[asset]);
        quoteToken = _quoteTokenForAsset[asset];
        primarySource = _primaryPriceSourceForAsset[asset];
        normalizedPriceFeed = _priceFeedForAsset[asset];
        primaryMaxStaleness = _primaryMaxStalenessForAsset[asset];
        if (source == PricingSource.ChainlinkAssetQuote || source == PricingSource.UniswapV3Twap) {
            (secondarySource, secondaryMaxStaleness,,,) =
                IAssetMarketRegistry(_assetMarketRegistry).quoteTokenConfig(quoteToken);
        }
    }

    function maxStalenessForAsset(address asset) external view onlyDelegateCall returns (uint32) {
        uint32 primaryMaxStaleness = _maxStalenessForAsset[asset];
        if (PricingSource(_pricingSourceForAsset[asset]) != PricingSource.ChainlinkAssetQuote) {
            return primaryMaxStaleness;
        }
        (, uint32 quoteMaxStaleness,,,) = IAssetMarketRegistry(_assetMarketRegistry)
            .quoteTokenConfig(_quoteTokenForAsset[asset]);
        return primaryMaxStaleness > quoteMaxStaleness
            ? primaryMaxStaleness
            : quoteMaxStaleness;
    }

    function pricingSourceForAsset(address asset)
        external
        view
        onlyDelegateCall
        returns (PricingSource)
    {
        return PricingSource(_pricingSourceForAsset[asset]);
    }

    function assetCount() external view onlyDelegateCall returns (uint256) {
        return _assets.length;
    }

    function assetAt(uint256 index) external view onlyDelegateCall returns (address) {
        return _assets[index];
    }

    function targetWeightsBps() external view onlyDelegateCall returns (uint16[] memory weights) {
        weights = new uint16[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
        }
    }

    function totalAssetsValue() external view onlyDelegateCall returns (uint256 nav) {
        return _portfolioCalculator.portfolioValue(address(this), _assets);
    }

    function navPerShare() external view onlyDelegateCall returns (uint256) {
        uint256 supply = _previewSupplyAfterAccrual();
        if (supply == 0) return 0;
        uint256 nav = _portfolioCalculator.portfolioValue(address(this), _assets);
        return MathEx.mulDiv(nav, 1e18, supply);
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
        uint256 nav = _portfolioCalculator.portfolioValue(address(this), _assets);
        if (nav == 0) revert ZeroNav();
        uint256 tokenValue = _portfolioCalculator.assetValueForVault(
            address(this), token, IERC20(token).balanceOf(address(this))
        );
        return MathEx.mulDiv(tokenValue, BPS, nav);
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
        uint256 target = targetWeightBps[token];
        (challengeLower, challengeUpper) = _band(target, challengeWeightDeviationBps);
        (completionLower, completionUpper) = _band(target, maxWeightDeviationBps);
    }

    function isWithinTargetBands() external view onlyDelegateCall returns (bool) {
        return _isWithinBands(maxWeightDeviationBps);
    }

    function isWithinChallengeBands() external view onlyDelegateCall returns (bool) {
        return _isWithinBands(challengeWeightDeviationBps);
    }

    function canProposeStrategy() external view onlyDelegateCall returns (bool) {
        if (sunset) return false;
        // Validator timestamp drift is immaterial to the fixed multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        bool cooldownActive = block.timestamp < _nextStrategyChangeTime();
        if (
            challengeActive || strategicRebalanceActive || strategyProposalPending || cooldownActive
        ) return false;
        return _isWithinBands(maxWeightDeviationBps);
    }

    function challengeTimeRemaining() external view onlyDelegateCall returns (uint256) {
        // Challenge deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (!challengeActive || block.timestamp >= challengeDeadline) return 0;
        return uint256(challengeDeadline) - block.timestamp;
    }

    function nextStrategyChangeTime() external view onlyDelegateCall returns (uint256) {
        return _nextStrategyChangeTime();
    }

    function feeState() external view onlyDelegateCall returns (FeeState) {
        return _currentFeeState();
    }

    function feesAccruing() external view onlyDelegateCall returns (bool) {
        return _currentFeeState() == FeeState.Accruing;
    }

    function feesEscrowed() external view onlyDelegateCall returns (bool) {
        return _currentFeeState() == FeeState.Escrowed;
    }

    function feesSuspended() external view onlyDelegateCall returns (bool) {
        FeeState state = _currentFeeState();
        return state == FeeState.Suspended || state == FeeState.Sunset;
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
            uint256 candidate = MathEx.mulDiv(amounts[i], supply, reserve);
            if (candidate < lpAmount) lpAmount = candidate;
        }
        if (lpAmount == type(uint256).max) return 0;

        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            uint256 required = MathEx.mulDivUp(lpAmount, reserve, supply);
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
            amounts[i] =
                MathEx.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), lpAmount, supply);
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
            amountsIn[i] =
                MathEx.mulDivUp(shares, IERC20(_assets[i]).balanceOf(address(this)), supply);
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
            amountsOut[i] =
                MathEx.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), shares, supply);
        }
    }

    function recentRebalanceCount() external view onlyDelegateCall returns (uint256) {
        return rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
    }

    function recentRebalanceRecord(uint256 index)
        external
        view
        onlyDelegateCall
        returns (RebalanceRecord memory)
    {
        uint256 storedCount = rebalanceCount < RECENT_REBALANCE_CAP
            ? rebalanceCount
            : RECENT_REBALANCE_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first =
            rebalanceCount > RECENT_REBALANCE_CAP ? rebalanceCount - RECENT_REBALANCE_CAP : 0;
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
        if (storedRecoveryAt > timestamp && maxNavLossBps != 0) {
            uint256 used = MathEx.mulDivUp(
                storedRecoveryAt - timestamp, maxNavLossBps, NAV_LOSS_RECOVERY_PERIOD
            );
            // Bucket usage cannot exceed the configured maximum of 200 BPS.
            // forge-lint: disable-next-line(unsafe-typecast)
            usedLossBps = uint16(used);
        }
        // Bucket recovery timestamps fit uint64 for the lifetime of the chain.
        // forge-lint: disable-next-line(unsafe-typecast)
        recoveryAt = uint64(storedRecoveryAt > timestamp ? storedRecoveryAt : timestamp);
        maximumLossBps = maxNavLossBps;
    }

    function recentTradeExecutionCount() external view onlyDelegateCall returns (uint256) {
        return
            tradeExecutionCount < RECENT_EXECUTION_CAP ? tradeExecutionCount : RECENT_EXECUTION_CAP;
    }

    function recentTradeExecutionRecord(uint256 index)
        external
        view
        onlyDelegateCall
        returns (TradeExecutionRecord memory)
    {
        uint256 storedCount = tradeExecutionCount < RECENT_EXECUTION_CAP
            ? tradeExecutionCount
            : RECENT_EXECUTION_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first = tradeExecutionCount > RECENT_EXECUTION_CAP
            ? tradeExecutionCount - RECENT_EXECUTION_CAP
            : 0;
        return _recentTradeExecutions[(first + index) % RECENT_EXECUTION_CAP];
    }

    function _previewSupplyAfterAccrual() private view returns (uint256 supply) {
        supply = totalSupply;
        if (sunset) return supply;
        uint256 previousTimestamp = lastFeeAccrualTimestamp;
        // Fee previews intentionally follow chain time, matching state-changing accrual.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= previousTimestamp) return supply;

        // forge-lint: disable-next-line(block-timestamp)
        uint256 end = challengeActive && block.timestamp > challengeDeadline
            ? uint256(challengeDeadline)
            : block.timestamp;
        if (end <= previousTimestamp || creatorFeeBpsPerYear == 0) return supply;

        (uint256 feeShares,) = _portfolioCalculator.feeSharesAfterElapsed(
            totalSupply,
            challengeActive ? _challengeFeeAccrualRemainderWad : _feeAccrualRemainderWad,
            creatorFeeBpsPerYear,
            end - previousTimestamp
        );
        // forge-lint: disable-next-line(block-timestamp)
        if (challengeActive && block.timestamp > challengeDeadline) {
            uint256 forfeitedShares = escrowedManagerFeeShares + feeShares;
            uint256 rewardShares = MathEx.mulDiv(forfeitedShares, CHALLENGE_CALLER_REWARD_BPS, BPS);
            return supply - escrowedManagerFeeShares + rewardShares;
        }
        supply += feeShares;
    }

    function _requireDepositsOpen() private view {
        if (sunset) revert VaultSunset();
        if (_assets.length == 0) revert EmptyPortfolio();
        if (IProtocolPortfolioLimits(factory).depositsPaused()) revert ProtocolDepositsPaused();
        if (IProtocolPortfolioLimits(factory).vaultDepositsPaused(address(this))) {
            revert VaultDepositsPaused();
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (targetWeightBps[asset] == 0) revert DepositsPausedForRetiringAsset(asset);
        }
    }

    function _isWithinBands(uint16 deviationBps) private view returns (bool) {
        if (!_retiringBalancesAreWithinDust()) return false;
        uint256[] memory weights = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
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
        return uint256(lastCompletedStrategyTimestamp) + STRATEGY_CHANGE_COOLDOWN;
    }

    function _currentFeeState() private view returns (FeeState) {
        if (sunset) return FeeState.Sunset;
        if (!challengeActive) return FeeState.Accruing;
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > challengeDeadline ? FeeState.Suspended : FeeState.Escrowed;
    }

    function _containsAsset(address asset) private view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
    }
}
