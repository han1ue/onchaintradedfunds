// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IERC20Metadata } from "./interfaces/IERC20.sol";

/// @notice Optional permissionless discovery index for mechanically valid OTF assets.
/// @dev Vaults never consult this contract for eligibility or pricing.
contract AssetRegistry is IAssetRegistry {
    error ZeroAddress();
    error AssetNotContract(address asset);
    error TokenDecimalsUnavailable(address asset);
    error UnsupportedAssetDecimals(address asset, uint8 decimals_);
    error AssetAlreadyRegistered(address asset);

    event AssetRegistered(address indexed asset, address indexed registrar);
    mapping(address => bool) public isRegisteredAsset;

    function registerAsset(address asset) external {
        _validateAsset(asset);
        if (isRegisteredAsset[asset]) revert AssetAlreadyRegistered(asset);
        isRegisteredAsset[asset] = true;
        emit AssetRegistered(asset, msg.sender);
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
}
