// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { RebalanceRecord, StrategyVersion, TradeExecutionRecord } from "./VaultTypes.sol";

/// @notice Read-only extension used by ManagedOTFVault through codehash-pinned delegatecall.
contract ManagedOTFVaultView is ManagedOTFVaultStorage {
    address private immutable _self;

    constructor() {
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
        uint256 activeCount;
        for (uint256 i = 0; i < _assets.length; i++) {
            if (!_isRetiringAsset(_assets[i])) activeCount++;
        }
        tokens = new address[](activeCount);
        weights = new uint256[](activeCount);
        uint256[] memory effectiveWeights = _effectiveTargetWeights();
        uint256 cursor;
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_isRetiringAsset(_assets[i])) continue;
            tokens[cursor] = _assets[i];
            weights[cursor] = effectiveWeights[i];
            cursor++;
        }
    }

    function totalConstituents() external view onlyDelegateCall returns (uint256 count) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (!_isRetiringAsset(_assets[i])) count++;
        }
    }

    function getWeight(address token)
        external
        view
        onlyDelegateCall
        returns (uint256 weight)
    {
        if (!_containsAsset(token) || _isRetiringAsset(token)) revert NotConstituent(token);
        uint256[] memory effectiveWeights = _effectiveTargetWeights();
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == token) return effectiveWeights[i];
        }
        revert NotConstituent(token);
    }

    function isConstituent(address token) external view onlyDelegateCall returns (bool) {
        return _containsAsset(token) && !_isRetiringAsset(token);
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
        uint256 storedCount =
            rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first =
            rebalanceCount > RECENT_REBALANCE_CAP ? rebalanceCount - RECENT_REBALANCE_CAP : 0;
        return _recentRebalances[(first + index) % RECENT_REBALANCE_CAP];
    }

    function navLossEpochState()
        external
        view
        onlyDelegateCall
        returns (
            uint64 epochId,
            uint64 startsAt,
            uint64 endsAt,
            uint16 usedLossBps,
            uint16 maximumLossBps
        )
    {
        uint256 calculatedId = (block.timestamp - uint256(navLossEpochAnchor)) / NAV_LOSS_EPOCH;
        // Epoch counts and timestamps fit uint64 for the lifetime of the chain.
        // forge-lint: disable-next-line(unsafe-typecast)
        epochId = uint64(calculatedId);
        // forge-lint: disable-next-line(unsafe-typecast)
        startsAt = uint64(uint256(navLossEpochAnchor) + calculatedId * NAV_LOSS_EPOCH);
        // forge-lint: disable-next-line(unsafe-typecast)
        endsAt = uint64(uint256(startsAt) + NAV_LOSS_EPOCH);
        usedLossBps = epochId == _navLossEpochId ? _navLossEpochUsedBps : 0;
        maximumLossBps = maxNavLossBps;
    }

    function recentTradeExecutionCount() external view onlyDelegateCall returns (uint256) {
        return tradeExecutionCount < RECENT_EXECUTION_CAP
            ? tradeExecutionCount
            : RECENT_EXECUTION_CAP;
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

    function _containsAsset(address asset) private view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
    }
}
