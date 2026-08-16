// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetStatus, IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IERC20Metadata } from "./interfaces/IERC20.sol";

contract AssetRegistry is IAssetRegistry {
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error AssetNotContract(address asset);
    error TokenDecimalsUnavailable(address asset);
    error UnsupportedAssetDecimals(address asset, uint8 decimals_);
    error AssetAlreadyRegistered(address asset);
    error InvalidAssetStatus(AssetStatus status);

    event AssetApprovalChanged(address indexed asset, bool approved);
    event AssetRegistered(address indexed asset, address indexed registrar);
    event AssetStatusChanged(
        address indexed asset, AssetStatus previousStatus, AssetStatus newStatus
    );
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
    mapping(address => AssetStatus) private _statusOf;

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

    function registerOpenAsset(address asset) external {
        _validateAsset(asset);
        if (_statusOf[asset] != AssetStatus.Unregistered) revert AssetAlreadyRegistered(asset);
        _setStatus(asset, AssetStatus.Open);
        emit AssetRegistered(asset, msg.sender);
    }

    function setAssetStatus(address asset, AssetStatus newStatus) external onlyOwner {
        if (newStatus == AssetStatus.Unregistered) revert InvalidAssetStatus(newStatus);
        _validateAsset(asset);
        _setStatus(asset, newStatus);
    }

    /// @notice Backwards-compatible owner surface used by legacy deployment tooling.
    /// @dev Approval maps to Qualified; revocation maps to Blocked so redemptions remain possible.
    function setAssetApproved(address asset, bool approved) external onlyOwner {
        _validateAsset(asset);
        _setStatus(asset, approved ? AssetStatus.Qualified : AssetStatus.Blocked);
        emit AssetApprovalChanged(asset, approved);
    }

    function statusOf(address asset) external view returns (AssetStatus) {
        return _statusOf[asset];
    }

    function canBeConstituent(address asset) public view returns (bool) {
        AssetStatus status = _statusOf[asset];
        return status == AssetStatus.Open || status == AssetStatus.Qualified;
    }

    function isQualifiedAsset(address asset) external view returns (bool) {
        return _statusOf[asset] == AssetStatus.Qualified;
    }

    function isApprovedAsset(address asset) external view returns (bool) {
        return canBeConstituent(asset);
    }

    function _validateAsset(address asset) private view {
        if (asset == address(0)) revert ZeroAddress();
        if (asset.code.length == 0) revert AssetNotContract(asset);
        uint8 tokenDecimals;
        try IERC20Metadata(asset).decimals() returns (uint8 decimals_) {
            tokenDecimals = decimals_;
        } catch {
            revert TokenDecimalsUnavailable(asset);
        }
        if (tokenDecimals != 18) revert UnsupportedAssetDecimals(asset, tokenDecimals);
    }

    function _setStatus(address asset, AssetStatus newStatus) private {
        AssetStatus previousStatus = _statusOf[asset];
        _statusOf[asset] = newStatus;
        emit AssetStatusChanged(asset, previousStatus, newStatus);
    }
}
