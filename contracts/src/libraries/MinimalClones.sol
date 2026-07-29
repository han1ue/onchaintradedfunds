// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MinimalClones {
    error CloneDeploymentFailed();

    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x14), 0x363d3d373d3d3d363d730000000000000000000000000000000000000000)
            mstore(add(ptr, 0x28), shl(0x60, implementation))
            mstore(add(ptr, 0x3c), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create2(0, ptr, 0x37, salt)
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

