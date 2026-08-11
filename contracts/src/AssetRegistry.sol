// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IERC20Metadata } from "./interfaces/IERC20.sol";

contract AssetRegistry is IAssetRegistry {
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error AssetNotContract(address asset);
    error TokenDecimalsUnavailable(address asset);
    error UnsupportedAssetDecimals(address asset, uint8 decimals_);

    event AssetApprovalChanged(address indexed asset, bool approved);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
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

    function beginOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnershipTransfer() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setAssetApproved(address asset, bool approved) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        if (approved) {
            if (asset.code.length == 0) revert AssetNotContract(asset);
            try IERC20Metadata(asset).decimals() returns (uint8 decimals_) {
                if (decimals_ != 18) revert UnsupportedAssetDecimals(asset, decimals_);
            } catch {
                revert TokenDecimalsUnavailable(asset);
            }
        }
        approvedAssets[asset] = approved;
        emit AssetApprovalChanged(asset, approved);
    }

    function isApprovedAsset(address asset) external view returns (bool) {
        return approvedAssets[asset];
    }
}
