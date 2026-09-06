// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console2 } from "forge-std/console2.sol";
import { TestBase } from "../TestBase.sol";

abstract contract ActionAccounting is TestBase {
    mapping(bytes4 => uint256) public successes;
    mapping(bytes4 => uint256) public expectedFailures;
    mapping(bytes4 => uint256) public noOps;

    function report(bytes4[] memory selectors) external view {
        for (uint256 i; i < selectors.length; i++) {
            console2.logBytes4(selectors[i]);
            console2.log("successful", successes[selectors[i]]);
            console2.log("expected failures", expectedFailures[selectors[i]]);
            console2.log("no-ops", noOps[selectors[i]]);
        }
    }

    function _rejected(address target, bytes memory callData, bytes memory expected) internal {
        (bool ok, bytes memory reason) = target.call(callData);
        require(!ok, "expected rejection succeeded");
        require(keccak256(reason) == keccak256(expected), "unexpected rejection reason");
        expectedFailures[msg.sig]++;
    }
}
