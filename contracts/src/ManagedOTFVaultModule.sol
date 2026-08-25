// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";

/// @notice Minimal common guard for codehash-pinned vault extension modules.
abstract contract ManagedOTFVaultModule is ManagedOTFVaultStorage {
    address private immutable _moduleSelf = address(this);

    modifier onlyDelegateCall() {
        if (address(this) == _moduleSelf) revert DirectStrategyCall();
        _;
    }

    function transfer(address, uint256) external pure virtual override returns (bool) {
        revert DirectStrategyCall();
    }

    function approve(address, uint256) external pure virtual override returns (bool) {
        revert DirectStrategyCall();
    }

    function transferFrom(address, address, uint256) external pure virtual override returns (bool) {
        revert DirectStrategyCall();
    }
}
