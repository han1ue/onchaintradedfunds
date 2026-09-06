// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TestBase, InvariantTestBase } from "./TestBase.sol";

contract SensitivityHandler is TestBase {
    error SentinelUnexpectedRevert();

    uint256 public calls;

    function check() external {
        calls++;
        require(!vm.envOr("INVARIANT_SENTINEL_ASSERT", false), "SENTINEL_HANDLER_ASSERTION");
        if (vm.envOr("INVARIANT_SENTINEL_REVERT", false)) revert SentinelUnexpectedRevert();
    }
}

contract InvariantSensitivityTest is TestBase, InvariantTestBase {
    function setUp() public {
        SensitivityHandler handler = new SensitivityHandler();
        bytes4[] memory s = new bytes4[](1);
        s[0] = handler.check.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), s));
    }

    // Only the handler can fail: this detects a campaign that silently swallows reverts.
    function invariantHandlerFailuresMustPropagate() public pure {
        assertTrue(true);
    }
}
