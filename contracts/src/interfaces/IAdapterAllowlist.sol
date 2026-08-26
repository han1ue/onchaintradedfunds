// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAdapterAllowlist {
    function isRebalanceAdapterApproved(address adapter) external view returns (bool);
    function isEntryAdapterApproved(address adapter) external view returns (bool);
    function isExitAdapterApproved(address adapter) external view returns (bool);
    function isVault(address vault) external view returns (bool);
    function depositsPaused() external view returns (bool);
    function vaultDepositsPaused(address vault) external view returns (bool);
}
