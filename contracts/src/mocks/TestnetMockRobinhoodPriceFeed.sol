// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TestnetMockPriceFeed } from "./TestnetMockPriceFeed.sol";

/// @notice Robinhood Stock Token Chainlink-compatible synthetic feed for testnet only.
/// @dev Supplies its own unpaused status. Production uses RobinhoodChainlinkPriceFeed to source the
///      same status from the associated Stock Token without changing consumer behavior.
contract TestnetMockRobinhoodPriceFeed is TestnetMockPriceFeed {
    constructor(address owner_, uint8 decimals_, int256 answer_, string memory description_)
        TestnetMockPriceFeed(owner_, decimals_, answer_, description_)
    { }

    function isRobinhoodPriceFeed() external pure returns (bool) {
        return true;
    }

    function oraclePaused() external pure returns (bool) {
        return false;
    }
}
