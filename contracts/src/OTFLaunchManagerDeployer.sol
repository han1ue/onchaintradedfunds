// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OTFLaunchManager } from "./OTFLaunchManager.sol";

/// @notice Deterministic deployer used to mine the V4 afterSwap hook permission bits.
contract OTFLaunchManagerDeployer {
    event LaunchManagerDeployed(address indexed launchManager, bytes32 indexed salt);

    function deploy(
        bytes32 salt,
        address otf,
        address weth,
        address poolManager,
        address stateView,
        address positionManager,
        address permit2
    ) external returns (OTFLaunchManager launchManager) {
        launchManager = new OTFLaunchManager{ salt: salt }(
            otf, weth, poolManager, stateView, positionManager, permit2
        );
        emit LaunchManagerDeployed(address(launchManager), salt);
    }
}
