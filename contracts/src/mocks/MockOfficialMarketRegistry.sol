// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOfficialMarketRegistry {
    mapping(address vault => address pool) public officialPool;

    function canonicalPool(address vault) external view returns (address pool) {
        return officialPool[vault];
    }

    function createOfficialPool(address vault) external returns (address pool) {
        pool = address(uint160(uint256(keccak256(abi.encode(vault, msg.sender)))));
        officialPool[vault] = pool;
    }
}
