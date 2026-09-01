// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IETHUSDOracle } from "./interfaces/IETHUSDOracle.sol";

/// @notice Robinhood Testnet-only ETH/USD oracle fixed at exactly $2,000.
contract FakeETHUSDOracle is IETHUSDOracle {
    int256 public constant ANSWER = 2_000e8;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, ANSWER, block.timestamp, block.timestamp, 1);
    }
}
