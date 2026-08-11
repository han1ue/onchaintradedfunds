// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RebalanceRecord, TradeExecutionRecord } from "../VaultTypes.sol";

interface IManagedOTFVaultView {
    function recentRebalanceCount() external view returns (uint256);
    function recentRebalanceRecord(uint256 index) external view returns (RebalanceRecord memory);
    function navLossBudgetState()
        external
        view
        returns (uint64 recoveryAt, uint16 usedLossBps, uint16 maximumLossBps);
    function recentTradeExecutionCount() external view returns (uint256);
    function recentTradeExecutionRecord(uint256 index)
        external
        view
        returns (TradeExecutionRecord memory);
}
