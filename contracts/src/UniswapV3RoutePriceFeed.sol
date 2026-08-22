// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { IERC20Metadata } from "./interfaces/IERC20.sol";
import { MAX_ORACLE_STALENESS } from "./interfaces/IOracleTypes.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { UniswapV3TwapMath } from "./libraries/UniswapV3TwapMath.sol";

interface IUniswapV3OraclePool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        );
}

/// @notice Normalizes an asset/quote-token V3 TWAP through the registry's quote-token/USD feed.
contract UniswapV3RoutePriceFeed is AggregatorV3Interface {
    uint8 private constant OUTPUT_DECIMALS = 8;
    uint32 public constant TWAP_WINDOW = 1 hours;

    error ZeroAddress();
    error InvalidPoolPair(address pool);
    error InvalidTwapPrice();
    error FeedNotContract(address feed);
    error InvalidMaxStaleness();
    error MaxStalenessTooHigh(uint32 supplied, uint32 maximum);
    error InvalidOraclePrice(address base, int256 answer);
    error InvalidOracleTimestamp(address base, uint256 timestamp);
    error IncompleteOracleRound(address base, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address base, uint256 updatedAt, uint256 maxStaleness);
    error UnsupportedDecimals(address token, uint8 decimals_);
    error PriceOverflow();

    address public immutable asset;
    address public immutable quoteToken;
    uint8 public immutable quoteTokenDecimals;
    IUniswapV3OraclePool public immutable assetQuotePool;
    IAssetMarketRegistry public immutable marketRegistry;

    constructor(
        address asset_,
        address quoteToken_,
        IUniswapV3OraclePool assetQuotePool_,
        IAssetMarketRegistry marketRegistry_
    ) {
        if (
            asset_ == address(0) || quoteToken_ == address(0)
                || address(assetQuotePool_) == address(0) || address(marketRegistry_) == address(0)
        ) revert ZeroAddress();
        if (address(assetQuotePool_).code.length == 0) {
            revert InvalidPoolPair(address(assetQuotePool_));
        }
        if (address(marketRegistry_).code.length == 0) {
            revert FeedNotContract(address(marketRegistry_));
        }
        if (!_isPair(assetQuotePool_, asset_, quoteToken_)) {
            revert InvalidPoolPair(address(assetQuotePool_));
        }
        uint8 tokenDecimals = IERC20Metadata(quoteToken_).decimals();
        if (tokenDecimals > 36) revert UnsupportedDecimals(quoteToken_, tokenDecimals);

        asset = asset_;
        quoteToken = quoteToken_;
        quoteTokenDecimals = tokenDecimals;
        assetQuotePool = assetQuotePool_;
        marketRegistry = marketRegistry_;

        _latestRoundData();
    }

    function decimals() external pure returns (uint8) {
        return OUTPUT_DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "OTF Uniswap V3 ASSET/QUOTE x QUOTE/USD";
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

    function quoteAssetInUsd() public view returns (uint256) {
        (, uint256 quoteUsdAnswer,,, uint8 feedDecimals) = _readQuoteUsd();
        return _quoteAssetInUsd(quoteUsdAnswer, feedDecimals);
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
        uint256 quoteUsdAnswer;
        uint8 feedDecimals;
        (roundId, quoteUsdAnswer, startedAt, updatedAt, feedDecimals) = _readQuoteUsd();
        uint256 normalized = _quoteAssetInUsd(quoteUsdAnswer, feedDecimals);
        uint256 twapStartedAt = block.timestamp - TWAP_WINDOW;
        if (twapStartedAt < startedAt) startedAt = twapStartedAt;
        answeredInRound = roundId;
        // The explicit bound in _quoteAssetInUsd makes this conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        answer = int256(normalized);
    }

    function _quoteAssetInUsd(uint256 quoteUsdAnswer, uint8 feedDecimals)
        private
        view
        returns (uint256 answer)
    {
        int24 assetQuoteTick = _meanTick(assetQuotePool);
        uint256 quoteAmount = UniswapV3TwapMath.quoteAtTick(assetQuoteTick, 1e18, asset, quoteToken);
        if (quoteAmount == 0) revert InvalidTwapPrice();
        answer = MathEx.mulDiv(quoteAmount, quoteUsdAnswer, 10 ** uint256(quoteTokenDecimals));
        if (feedDecimals < OUTPUT_DECIMALS) {
            uint256 scaleUp = 10 ** uint256(OUTPUT_DECIMALS - feedDecimals);
            if (answer > type(uint256).max / scaleUp) revert PriceOverflow();
            answer *= scaleUp;
        } else if (feedDecimals > OUTPUT_DECIMALS) {
            answer /= 10 ** uint256(feedDecimals - OUTPUT_DECIMALS);
        }
        if (answer == 0 || answer > uint256(type(int256).max)) revert PriceOverflow();
    }

    function _readQuoteUsd()
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
        int256 signedAnswer;
        uint80 answeredInRound;
        (address quoteUsdFeed, uint32 quoteUsdMaxStaleness,,,) =
            marketRegistry.quoteTokenConfig(quoteToken);
        if (quoteUsdFeed.code.length == 0) revert FeedNotContract(quoteUsdFeed);
        if (quoteUsdMaxStaleness == 0) revert InvalidMaxStaleness();
        if (quoteUsdMaxStaleness > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(quoteUsdMaxStaleness, MAX_ORACLE_STALENESS);
        }
        (roundId, signedAnswer, startedAt, updatedAt, answeredInRound) =
            AggregatorV3Interface(quoteUsdFeed).latestRoundData();
        if (signedAnswer <= 0) revert InvalidOraclePrice(quoteToken, signedAnswer);
        // Oracle validity and freshness are necessarily measured against chain time.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 currentTimestamp = block.timestamp;
        if (
            roundId == 0 || startedAt == 0 || updatedAt == 0 || startedAt > updatedAt
                || updatedAt > currentTimestamp
        ) revert InvalidOracleTimestamp(quoteToken, updatedAt);
        if (answeredInRound < roundId) {
            revert IncompleteOracleRound(quoteToken, roundId, answeredInRound);
        }
        if (currentTimestamp > updatedAt + quoteUsdMaxStaleness) {
            revert StaleOraclePrice(quoteToken, updatedAt, quoteUsdMaxStaleness);
        }
        feedDecimals = AggregatorV3Interface(quoteUsdFeed).decimals();
        if (feedDecimals > 36) {
            revert UnsupportedDecimals(quoteUsdFeed, feedDecimals);
        }
        // The positive-answer check makes this conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        answer = uint256(signedAnswer);
    }

    function _meanTick(IUniswapV3OraclePool pool) private view returns (int24 arithmeticMeanTick) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int56 window = int56(uint56(TWAP_WINDOW));
        int56 mean = delta / window;
        if (delta < 0 && delta % window != 0) mean--;
        if (mean < type(int24).min || mean > type(int24).max) revert InvalidTwapPrice();
        // The explicit int24 bounds check guarantees this narrowing cast is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        arithmeticMeanTick = int24(mean);
    }

    function _isPair(IUniswapV3OraclePool pool, address first, address second)
        private
        view
        returns (bool)
    {
        address token0 = pool.token0();
        address token1 = pool.token1();
        return (token0 == first && token1 == second) || (token0 == second && token1 == first);
    }
}
