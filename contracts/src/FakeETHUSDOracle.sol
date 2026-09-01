// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";

/// @notice Robinhood Testnet-only ETH/USD oracle fixed at exactly $2,000.
contract FakeETHUSDOracle is AggregatorV3Interface {
    int256 public constant ANSWER = 2_000e8;

    function decimals() external pure override returns (uint8) {
        return 8;
    }

    function description() external pure override returns (string memory) {
        return "ETH / USD";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (
            uint80 id,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (roundId, ANSWER, block.timestamp, block.timestamp, roundId);
    }

    function latestRoundData()
        external
        view
        override
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
