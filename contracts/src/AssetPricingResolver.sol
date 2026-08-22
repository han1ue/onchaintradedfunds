// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ChainlinkRoutePriceFeed } from "./ChainlinkRoutePriceFeed.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IUniswapV3OraclePool, UniswapV3RoutePriceFeed } from "./UniswapV3RoutePriceFeed.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { MAX_ORACLE_STALENESS } from "./interfaces/IOracleTypes.sol";
import { AssetPricingConfig, PricingSource } from "./VaultTypes.sol";

interface IAssetPricingResolver {
    function validatePricing(address asset, AssetPricingConfig calldata config) external;

    /// @notice Simulates authoritative validation and returns the normalized USD quote.
    /// @dev Frontends call this non-view function with `eth_call`; composed/V3 resolution may
    ///      deploy ephemeral contracts inside that simulation.
    function validateAndQuotePrice(address asset, AssetPricingConfig calldata config)
        external
        returns (uint256 price, uint8 priceDecimals);

    function resolvePricing(address asset, AssetPricingConfig calldata config)
        external
        returns (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness
        );
}

/// @notice Mechanically validates creator-selected pricing and resolves a normalized per-vault feed.
contract AssetPricingResolver is IAssetPricingResolver {
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidPricingConfig(address asset);
    error MarketRegistryUnavailable();
    error InvalidAssetMarket(address asset, bytes32 marketId);
    error InvalidMaxStaleness(uint32 supplied);
    error MaxStalenessTooHigh(uint32 supplied, uint32 maximum);

    IAssetMarketRegistry public immutable marketRegistry;
    PortfolioCalculator public immutable calculator;

    constructor(IAssetMarketRegistry marketRegistry_, PortfolioCalculator calculator_) {
        if (address(calculator_) == address(0)) revert ZeroAddress();
        if (address(marketRegistry_) != address(0) && address(marketRegistry_).code.length == 0) {
            revert InvalidDependency(address(marketRegistry_));
        }
        if (address(calculator_).code.length == 0) {
            revert InvalidDependency(address(calculator_));
        }
        marketRegistry = marketRegistry_;
        calculator = calculator_;
    }

    function validatePricing(address asset, AssetPricingConfig calldata config) external {
        _resolve(asset, config, false);
    }

    function validateAndQuotePrice(address asset, AssetPricingConfig calldata config)
        external
        returns (uint256 price, uint8 priceDecimals)
    {
        (address normalizedFeed,,) = _resolve(asset, config, true);
        (, int256 answer,,,) = AggregatorV3Interface(normalizedFeed).latestRoundData();
        // Resolution validates that the normalized answer is positive.
        // forge-lint: disable-next-line(unsafe-typecast)
        price = uint256(answer);
        priceDecimals = AggregatorV3Interface(normalizedFeed).decimals();
    }

    function resolvePricing(address asset, AssetPricingConfig calldata config)
        external
        returns (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness
        )
    {
        return _resolve(asset, config, true);
    }

    function _resolve(address asset, AssetPricingConfig calldata config, bool deployWrapper)
        private
        returns (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness
        )
    {
        if (asset == address(0) || asset.code.length == 0 || config.primarySource.code.length == 0)
        {
            revert InvalidPricingConfig(asset);
        }
        if (
            config.source == PricingSource.ChainlinkDirect
                || config.source == PricingSource.RobinhoodDirect
        ) {
            _requireUnusedSecondary(config, asset);
            primaryStaleness = config.primaryMaxStaleness;
            _validateLeg(
                asset,
                config.primarySource,
                primaryStaleness,
                config.source == PricingSource.RobinhoodDirect
            );
            return (config.primarySource, bytes32(0), primaryStaleness);
        }

        if (config.source == PricingSource.ChainlinkAssetQuote) {
            _requireMarketRegistry();
            primaryStaleness = config.primaryMaxStaleness;
            address composedQuoteToken = config.quoteToken;
            (address composedQuoteUsdFeed, uint32 composedQuoteMaxStaleness) =
                _quoteConfig(composedQuoteToken, false);
            _validateLeg(asset, config.primarySource, primaryStaleness, false);
            _validateLeg(
                composedQuoteToken, composedQuoteUsdFeed, composedQuoteMaxStaleness, false
            );
            if (deployWrapper) {
                normalizedFeed = address(
                    new ChainlinkRoutePriceFeed(
                        asset,
                        composedQuoteToken,
                        AggregatorV3Interface(config.primarySource),
                        primaryStaleness,
                        marketRegistry
                    )
                );
            }
            return (normalizedFeed, bytes32(0), primaryStaleness);
        }

        if (config.source != PricingSource.UniswapV3Twap) revert InvalidPricingConfig(asset);
        _validateMaxStaleness(config.primaryMaxStaleness);
        _requireMarketRegistry();
        marketId = marketRegistry.registerV3Market(asset, config.primarySource);
        (address marketAsset, address pool,, bool active) = marketRegistry.marketFor(marketId);
        if (!active || marketAsset != asset || pool != config.primarySource) {
            revert InvalidAssetMarket(asset, marketId);
        }
        address quoteToken = marketRegistry.quoteTokenFor(marketId);
        if (quoteToken != config.quoteToken) revert InvalidPricingConfig(asset);
        primaryStaleness = config.primaryMaxStaleness;
        (address secondarySource, uint32 secondaryStaleness) = _quoteConfig(quoteToken, true);
        _validateLeg(quoteToken, secondarySource, secondaryStaleness, false);
        if (deployWrapper) {
            normalizedFeed = address(
                new UniswapV3RoutePriceFeed(
                    asset,
                    quoteToken,
                    IUniswapV3OraclePool(pool),
                    marketRegistry
                )
            );
            calculator.validatePriceFeed(
                asset, AggregatorV3Interface(normalizedFeed), primaryStaleness, false
            );
        }
        return (normalizedFeed, marketId, primaryStaleness);
    }

    function _requireMarketRegistry() private view {
        if (address(marketRegistry) == address(0)) revert MarketRegistryUnavailable();
    }

    function _quoteConfig(address quoteToken, bool forV3)
        private
        view
        returns (address usdFeed, uint32 maxStaleness)
    {
        (usdFeed, maxStaleness,,,) = marketRegistry.quoteTokenConfig(quoteToken);
        marketRegistry.validateQuoteToken(quoteToken, usdFeed, maxStaleness, forV3);
    }

    function _validateLeg(
        address base,
        address feed,
        uint32 maxStaleness,
        bool requireRobinhoodPauseCheck
    ) private view {
        if (feed.code.length == 0) revert InvalidPricingConfig(base);
        _validateMaxStaleness(maxStaleness);
        calculator.validatePriceFeed(
            base, AggregatorV3Interface(feed), maxStaleness, requireRobinhoodPauseCheck
        );
    }

    function _validateMaxStaleness(uint32 maxStaleness) private pure {
        if (maxStaleness == 0) revert InvalidMaxStaleness(maxStaleness);
        if (maxStaleness > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(maxStaleness, MAX_ORACLE_STALENESS);
        }
    }

    function _requireUnusedSecondary(AssetPricingConfig calldata config, address asset)
        private
        pure
    {
        if (config.quoteToken != address(0)) revert InvalidPricingConfig(asset);
    }
}
