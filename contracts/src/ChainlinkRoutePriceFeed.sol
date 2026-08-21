// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { MAX_ORACLE_STALENESS, OracleValidationMode } from "./interfaces/IOracleTypes.sol";
import { MathEx } from "./libraries/MathEx.sol";

interface IChainlinkPauseStatus {
    function oraclePaused() external view returns (bool);
}

/// @notice Normalizes an ASSET/WETH feed composed with WETH/USD into an 8-decimal USD feed.
/// @dev Both pinned legs are validated independently on every read. No fallback source exists.
contract ChainlinkRoutePriceFeed is AggregatorV3Interface {
    uint8 private constant OUTPUT_DECIMALS = 8;

    error ZeroAddress();
    error FeedNotContract(address feed);
    error InvalidMaxStaleness();
    error MaxStalenessTooHigh(uint32 supplied, uint32 maximum);
    error InvalidOraclePrice(address base, int256 answer);
    error InvalidOracleTimestamp(address base, uint256 timestamp);
    error IncompleteOracleRound(address base, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address base, uint256 updatedAt, uint256 maxStaleness);
    error UnsupportedFeedDecimals(address feed, uint8 decimals_);
    error OraclePauseStatusUnavailable(address base);
    error OraclePaused(address base);
    error PriceOverflow();

    address public immutable asset;
    address public immutable weth;
    AggregatorV3Interface public immutable assetWethFeed;
    AggregatorV3Interface public immutable wethUsdFeed;
    uint32 public immutable assetWethMaxStaleness;
    uint32 public immutable wethUsdMaxStaleness;
    OracleValidationMode public immutable assetWethValidationMode;
    OracleValidationMode public immutable wethUsdValidationMode;

    constructor(
        address asset_,
        address weth_,
        AggregatorV3Interface assetWethFeed_,
        AggregatorV3Interface wethUsdFeed_,
        uint32 assetWethMaxStaleness_,
        uint32 wethUsdMaxStaleness_,
        OracleValidationMode assetWethValidationMode_,
        OracleValidationMode wethUsdValidationMode_
    ) {
        if (
            asset_ == address(0) || weth_ == address(0) || address(assetWethFeed_) == address(0)
                || address(wethUsdFeed_) == address(0)
        ) revert ZeroAddress();
        if (address(assetWethFeed_).code.length == 0) {
            revert FeedNotContract(address(assetWethFeed_));
        }
        if (address(wethUsdFeed_).code.length == 0) {
            revert FeedNotContract(address(wethUsdFeed_));
        }
        if (assetWethMaxStaleness_ == 0 || wethUsdMaxStaleness_ == 0) {
            revert InvalidMaxStaleness();
        }
        if (assetWethMaxStaleness_ > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(assetWethMaxStaleness_, MAX_ORACLE_STALENESS);
        }
        if (wethUsdMaxStaleness_ > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(wethUsdMaxStaleness_, MAX_ORACLE_STALENESS);
        }
        asset = asset_;
        weth = weth_;
        assetWethFeed = assetWethFeed_;
        wethUsdFeed = wethUsdFeed_;
        assetWethMaxStaleness = assetWethMaxStaleness_;
        wethUsdMaxStaleness = wethUsdMaxStaleness_;
        assetWethValidationMode = assetWethValidationMode_;
        wethUsdValidationMode = wethUsdValidationMode_;

        _latestRoundData();
    }

    function decimals() external pure returns (uint8) {
        return OUTPUT_DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "OTF Chainlink ASSET/WETH x WETH/USD";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return _latestRoundData();
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return _latestRoundData();
    }

    function _latestRoundData()
        private
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        (
            uint80 assetRound,
            uint256 assetWethAnswer,
            uint256 assetStartedAt,
            uint256 assetUpdatedAt,
            uint8 assetDecimals
        ) = _readLeg(asset, assetWethFeed, assetWethMaxStaleness, assetWethValidationMode);
        (
            uint80 wethRound,
            uint256 wethUsdAnswer,
            uint256 wethStartedAt,
            uint256 wethUpdatedAt,
            uint8 wethDecimals
        ) = _readLeg(weth, wethUsdFeed, wethUsdMaxStaleness, wethUsdValidationMode);

        uint256 normalized =
            MathEx.mulDiv(assetWethAnswer, wethUsdAnswer, 10 ** uint256(assetDecimals));
        if (wethDecimals < OUTPUT_DECIMALS) {
            uint256 scaleUp = 10 ** uint256(OUTPUT_DECIMALS - wethDecimals);
            if (normalized > type(uint256).max / scaleUp) revert PriceOverflow();
            normalized *= scaleUp;
        } else if (wethDecimals > OUTPUT_DECIMALS) {
            normalized /= 10 ** uint256(wethDecimals - OUTPUT_DECIMALS);
        }
        if (normalized == 0 || normalized > uint256(type(int256).max)) revert PriceOverflow();

        roundId = assetRound < wethRound ? assetRound : wethRound;
        startedAt = assetStartedAt < wethStartedAt ? assetStartedAt : wethStartedAt;
        updatedAt = assetUpdatedAt < wethUpdatedAt ? assetUpdatedAt : wethUpdatedAt;
        answeredInRound = roundId;
        // The explicit bound above makes this conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        answer = int256(normalized);
    }

    function _readLeg(
        address base,
        AggregatorV3Interface feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    )
        private
        view
        returns (
            uint80 roundId,
            uint256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint8 feedDecimals
        )
    {
        if (validationMode == OracleValidationMode.RobinhoodStockToken) {
            bool paused;
            try IChainlinkPauseStatus(base).oraclePaused() returns (bool isPaused) {
                paused = isPaused;
            } catch {
                revert OraclePauseStatusUnavailable(base);
            }
            if (paused) revert OraclePaused(base);
        }

        int256 signedAnswer;
        uint80 answeredInRound;
        (roundId, signedAnswer, startedAt, updatedAt, answeredInRound) = feed.latestRoundData();
        if (signedAnswer <= 0) revert InvalidOraclePrice(base, signedAnswer);
        // Oracle validity and freshness are necessarily measured against chain time.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 currentTimestamp = block.timestamp;
        if (
            roundId == 0 || startedAt == 0 || updatedAt == 0 || startedAt > updatedAt
                || updatedAt > currentTimestamp
        ) revert InvalidOracleTimestamp(base, updatedAt);
        if (answeredInRound < roundId) {
            revert IncompleteOracleRound(base, roundId, answeredInRound);
        }
        if (currentTimestamp > updatedAt + maxStaleness) {
            revert StaleOraclePrice(base, updatedAt, maxStaleness);
        }
        feedDecimals = feed.decimals();
        if (feedDecimals > 36) {
            revert UnsupportedFeedDecimals(address(feed), feedDecimals);
        }
        // The positive-answer check makes this conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        answer = uint256(signedAnswer);
    }
}
