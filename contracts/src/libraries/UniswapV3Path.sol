// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library UniswapV3Path {
    uint256 internal constant ADDRESS_SIZE = 20;
    uint256 internal constant FEE_SIZE = 3;
    uint256 internal constant NEXT_OFFSET = ADDRESS_SIZE + FEE_SIZE;
    uint256 internal constant MIN_PATH_SIZE = ADDRESS_SIZE + NEXT_OFFSET;

    function hopCount(bytes calldata path) internal pure returns (uint256 hops) {
        if (path.length < MIN_PATH_SIZE || (path.length - ADDRESS_SIZE) % NEXT_OFFSET != 0) {
            return 0;
        }
        return (path.length - ADDRESS_SIZE) / NEXT_OFFSET;
    }

    function tokenAt(bytes calldata path, uint256 index) internal pure returns (address token) {
        uint256 offset = index * NEXT_OFFSET;
        assembly ("memory-safe") {
            token := shr(96, calldataload(add(path.offset, offset)))
        }
    }

    function feeAt(bytes calldata path, uint256 index) internal pure returns (uint24 fee) {
        uint256 offset = index * NEXT_OFFSET + ADDRESS_SIZE;
        assembly ("memory-safe") {
            fee := shr(232, calldataload(add(path.offset, offset)))
        }
    }
}
