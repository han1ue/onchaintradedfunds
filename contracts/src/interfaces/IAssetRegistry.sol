// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetRegistry {
    function isRegisteredAsset(address asset) external view returns (bool);
}
