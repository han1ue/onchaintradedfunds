// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ProtocolConstants {
    uint256 internal constant MAX_TRACKED_ASSETS = 100;
    uint256 internal constant MAX_INITIAL_SHARE_SUPPLY = 1_000_000 ether;
    uint256 internal constant MAX_STRATEGY_RATIONALE_BYTES = 2_048;
    uint256 internal constant MINIMUM_LIQUIDITY_SHARES = 1_000_000;
    uint16 internal constant MAX_ANNUAL_MANAGER_FEE_BPS = 2_000;
}
