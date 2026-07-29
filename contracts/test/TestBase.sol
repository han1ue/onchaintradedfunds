// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 selector) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        if (!value) revert("assertTrue failed");
    }

    function assertFalse(bool value) internal pure {
        if (value) revert("assertFalse failed");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        if (actual != expected) revert("assertEq(uint256) failed");
    }

    function assertEq(address actual, address expected) internal pure {
        if (actual != expected) revert("assertEq(address) failed");
    }

    function assertGt(uint256 actual, uint256 floor) internal pure {
        if (actual <= floor) revert("assertGt(uint256) failed");
    }
}
