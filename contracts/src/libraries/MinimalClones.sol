// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MinimalClones {
    error CloneDeploymentFailed();

    function clone(address implementation) internal returns (address instance) {
        bytes memory bytecode = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly {
            instance := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        if (instance == address(0)) revert CloneDeploymentFailed();
    }
}
