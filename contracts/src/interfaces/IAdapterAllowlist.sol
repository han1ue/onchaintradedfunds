// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAdapterAllowlist {
    function isTradeAdapterApproved(address adapter) external view returns (bool);
    function isVault(address vault) external view returns (bool);
    function depositsPaused() external view returns (bool);
    function vaultDepositsPaused(address vault) external view returns (bool);
}
