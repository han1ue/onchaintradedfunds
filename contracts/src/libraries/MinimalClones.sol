// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MinimalClones {
    error CloneDeploymentFailed();

    function cloneDeterministic(address implementation, bytes32 salt)
        internal
        returns (address instance)
    {
        bytes memory bytecode = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly {
            instance := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        if (instance == address(0)) revert CloneDeploymentFailed();
    }

    function predictDeterministicAddress(address implementation, bytes32 salt, address deployer)
        internal
        pure
        returns (address predicted)
    {
        bytes32 codeHash = keccak256(
            abi.encodePacked(
                hex"3d602d80600a3d3981f3",
                hex"363d3d373d3d3d363d73",
                implementation,
                hex"5af43d82803e903d91602b57fd5bf3"
            )
        );
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, codeHash))))
        );
    }
}
