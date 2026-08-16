// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum AssetStatus {
    Unregistered,
    Open,
    Qualified,
    Blocked
}

interface IAssetRegistry {
    function statusOf(address asset) external view returns (AssetStatus);
    function canBeConstituent(address asset) external view returns (bool);
    function isQualifiedAsset(address asset) external view returns (bool);
    function isApprovedAsset(address asset) external view returns (bool);
}
