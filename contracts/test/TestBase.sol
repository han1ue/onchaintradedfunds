// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256 newTimestamp) external;
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectPartialRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory entries);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function clearMockedCalls() external;
    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash, address deployer)
        external
        pure
        returns (address);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
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

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        if (actual != expected) revert("assertEq(bytes32) failed");
    }

    function assertEq(bool actual, bool expected) internal pure {
        if (actual != expected) revert("assertEq(bool) failed");
    }

    function assertEq(string memory actual, string memory expected) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) {
            revert("assertEq(string) failed");
        }
    }

    function assertGt(uint256 actual, uint256 floor) internal pure {
        if (actual <= floor) revert("assertGt(uint256) failed");
    }

    function assertGe(uint256 actual, uint256 floor) internal pure {
        if (actual < floor) revert("assertGe(uint256) failed");
    }

    function assertLt(uint256 actual, uint256 ceiling) internal pure {
        if (actual >= ceiling) revert("assertLt(uint256) failed");
    }

    function assertLe(uint256 actual, uint256 ceiling) internal pure {
        if (actual > ceiling) revert("assertLe(uint256) failed");
    }

    function assertApproxEqAbs(uint256 actual, uint256 expected, uint256 maximumDelta)
        internal
        pure
    {
        uint256 delta = actual >= expected ? actual - expected : expected - actual;
        if (delta > maximumDelta) revert("assertApproxEqAbs failed");
    }

    function bound(uint256 value, uint256 minimum, uint256 maximum)
        internal
        pure
        returns (uint256)
    {
        if (minimum > maximum) revert("bound invalid range");
        uint256 size = maximum - minimum + 1;
        return minimum + (value % size);
    }
}

abstract contract InvariantTestBase {
    address[] private _targetedContracts;

    function targetContract(address target) internal {
        _targetedContracts.push(target);
    }

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }
}
