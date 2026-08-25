// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";

interface IRobinhoodStockTokenPauseStatus {
    function oraclePaused() external view returns (bool);
}

/// @notice Robinhood-aware oracle that combines an official Chainlink feed with Stock Token status.
/// @dev Consumers use the same oracle interface in every environment. This production implementation
///      delegates prices to Chainlink and pause status to the associated Robinhood Stock Token.
contract RobinhoodChainlinkPriceFeed is AggregatorV3Interface {
    error InvalidDependency(address dependency);
    error OraclePauseStatusUnavailable(address asset);

    address public immutable asset;
    AggregatorV3Interface public immutable chainlinkFeed;

    constructor(address asset_, AggregatorV3Interface chainlinkFeed_) {
        if (asset_.code.length == 0) revert InvalidDependency(asset_);
        if (address(chainlinkFeed_).code.length == 0) {
            revert InvalidDependency(address(chainlinkFeed_));
        }

        (bool success, bytes memory result) =
            asset_.staticcall(abi.encodeCall(IRobinhoodStockTokenPauseStatus.oraclePaused, ()));
        if (!success || result.length != 32) revert OraclePauseStatusUnavailable(asset_);
        abi.decode(result, (bool));

        asset = asset_;
        chainlinkFeed = chainlinkFeed_;
    }

    function isRobinhoodPriceFeed() external pure returns (bool) {
        return true;
    }

    function oraclePaused() external view returns (bool) {
        return IRobinhoodStockTokenPauseStatus(asset).oraclePaused();
    }

    function decimals() external view returns (uint8) {
        return chainlinkFeed.decimals();
    }

    function description() external view returns (string memory) {
        return chainlinkFeed.description();
    }

    function version() external view returns (uint256) {
        return chainlinkFeed.version();
    }

    function getRoundData(uint80 roundId)
        external
        view
        returns (
            uint80 returnedRoundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return chainlinkFeed.getRoundData(roundId);
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
        return chainlinkFeed.latestRoundData();
    }
}
