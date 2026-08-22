// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { MAX_ORACLE_STALENESS } from "./interfaces/IOracleTypes.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Normalizes an ASSET/QUOTE feed composed with QUOTE/USD into an 8-decimal USD feed.
/// @dev The asset leg is pinned; the quote/USD leg is read from the registry on every call.
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
    error PriceOverflow();

    address public immutable asset;
    address public immutable quoteToken;
    AggregatorV3Interface public immutable assetQuoteFeed;
    uint32 public immutable assetQuoteMaxStaleness;
    IAssetMarketRegistry public immutable marketRegistry;

    constructor(
        address asset_,
        address quoteToken_,
        AggregatorV3Interface assetQuoteFeed_,
        uint32 assetQuoteMaxStaleness_,
        IAssetMarketRegistry marketRegistry_
    ) {
        if (
            asset_ == address(0) || quoteToken_ == address(0)
                || address(assetQuoteFeed_) == address(0) || address(marketRegistry_) == address(0)
        ) revert ZeroAddress();
        if (address(assetQuoteFeed_).code.length == 0) {
            revert FeedNotContract(address(assetQuoteFeed_));
        }
        if (address(marketRegistry_).code.length == 0) {
            revert FeedNotContract(address(marketRegistry_));
        }
        if (assetQuoteMaxStaleness_ == 0) revert InvalidMaxStaleness();
        if (assetQuoteMaxStaleness_ > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(assetQuoteMaxStaleness_, MAX_ORACLE_STALENESS);
        }
        asset = asset_;
        quoteToken = quoteToken_;
        assetQuoteFeed = assetQuoteFeed_;
        assetQuoteMaxStaleness = assetQuoteMaxStaleness_;
        marketRegistry = marketRegistry_;

        _latestRoundData();
    }

    function decimals() external pure returns (uint8) {
        return OUTPUT_DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "OTF Chainlink ASSET/QUOTE x QUOTE/USD";
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
        ) = _readLeg(asset, assetQuoteFeed, assetQuoteMaxStaleness);
        (address quoteUsdFeed, uint32 quoteUsdMaxStaleness,,,) =
            marketRegistry.quoteTokenConfig(quoteToken);
        (
            uint80 wethRound,
            uint256 wethUsdAnswer,
            uint256 wethStartedAt,
            uint256 wethUpdatedAt,
            uint8 wethDecimals
        ) = _readLeg(quoteToken, AggregatorV3Interface(quoteUsdFeed), quoteUsdMaxStaleness);

        uint256 normalized =
            Math.mulDiv(assetWethAnswer, wethUsdAnswer, 10 ** uint256(assetDecimals));
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

    function _readLeg(address base, AggregatorV3Interface feed, uint32 maxStaleness)
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
        if (address(feed).code.length == 0) {
            revert FeedNotContract(address(feed));
        }
        if (maxStaleness == 0) revert InvalidMaxStaleness();
        if (maxStaleness > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(maxStaleness, MAX_ORACLE_STALENESS);
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
