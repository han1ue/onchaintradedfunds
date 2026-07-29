// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";

contract AssetRegistry is IAssetRegistry {
    error NotOwner();
    error ZeroAddress();

    event AssetApprovalChanged(address indexed asset, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    mapping(address => bool) public approvedAssets;

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAssetApproved(address asset, bool approved) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        approvedAssets[asset] = approved;
        emit AssetApprovalChanged(asset, approved);
    }

    function isApprovedAsset(address asset) external view returns (bool) {
        return approvedAssets[asset];
    }
}

