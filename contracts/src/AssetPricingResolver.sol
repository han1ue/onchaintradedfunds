// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ChainlinkRoutePriceFeed } from "./ChainlinkRoutePriceFeed.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { IUniswapV3OraclePool, UniswapV3RoutePriceFeed } from "./UniswapV3RoutePriceFeed.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { MAX_ORACLE_STALENESS, OracleValidationMode } from "./interfaces/IOracleTypes.sol";
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
            uint32 primaryStaleness,
            uint32 secondaryStaleness,
            OracleValidationMode primaryMode,
            OracleValidationMode secondaryMode
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
    error InvalidValidationMode(OracleValidationMode supplied);

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
        (address normalizedFeed,,,,,) = _resolve(asset, config, true);
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
            uint32 primaryStaleness,
            uint32 secondaryStaleness,
            OracleValidationMode primaryMode,
            OracleValidationMode secondaryMode
        )
    {
        return _resolve(asset, config, true);
    }

    function _resolve(address asset, AssetPricingConfig calldata config, bool deployWrapper)
        private
        returns (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness,
            uint32 secondaryStaleness,
            OracleValidationMode primaryMode,
            OracleValidationMode secondaryMode
        )
    {
        if (asset == address(0) || asset.code.length == 0 || config.primarySource.code.length == 0)
        {
            revert InvalidPricingConfig(asset);
        }
        if (config.source == PricingSource.ChainlinkDirect) {
            _requireUnusedSecondary(config, asset);
            primaryStaleness = config.primaryMaxStaleness;
            primaryMode = config.primaryValidationMode;
            _validateLeg(asset, config.primarySource, primaryStaleness, primaryMode);
            return (
                config.primarySource,
                bytes32(0),
                primaryStaleness,
                0,
                primaryMode,
                OracleValidationMode.StandardChainlink
            );
        }

        if (config.source == PricingSource.ChainlinkAssetQuote) {
            if (config.secondarySource.code.length == 0) revert InvalidPricingConfig(asset);
            _requireMarketRegistry();
            primaryStaleness = config.primaryMaxStaleness;
            secondaryStaleness = config.secondaryMaxStaleness;
            primaryMode = config.primaryValidationMode;
            secondaryMode = config.secondaryValidationMode;
            address composedQuoteToken = config.quoteToken;
            marketRegistry.validateQuoteToken(
                composedQuoteToken,
                config.secondarySource,
                secondaryStaleness,
                secondaryMode,
                false
            );
            _validateLeg(asset, config.primarySource, primaryStaleness, primaryMode);
            _validateLeg(
                composedQuoteToken, config.secondarySource, secondaryStaleness, secondaryMode
            );
            if (deployWrapper) {
                normalizedFeed = address(
                    new ChainlinkRoutePriceFeed(
                        asset,
                        composedQuoteToken,
                        AggregatorV3Interface(config.primarySource),
                        AggregatorV3Interface(config.secondarySource),
                        primaryStaleness,
                        secondaryStaleness,
                        primaryMode,
                        secondaryMode
                    )
                );
            }
            return (
                normalizedFeed,
                bytes32(0),
                primaryStaleness,
                secondaryStaleness,
                primaryMode,
                secondaryMode
            );
        }

        if (config.primaryValidationMode != OracleValidationMode.StandardChainlink) {
            revert InvalidValidationMode(config.primaryValidationMode);
        }
        _validateMaxStaleness(config.primaryMaxStaleness);
        if (config.secondarySource.code.length == 0) revert InvalidPricingConfig(asset);
        _validateMaxStaleness(config.secondaryMaxStaleness);
        _requireMarketRegistry();
        marketId = marketRegistry.registerV3Market(asset, config.primarySource);
        (address marketAsset, address pool,, bool active) = marketRegistry.marketFor(marketId);
        if (!active || marketAsset != asset || pool != config.primarySource) {
            revert InvalidAssetMarket(asset, marketId);
        }
        address quoteToken = marketRegistry.quoteTokenFor(marketId);
        if (quoteToken != config.quoteToken) revert InvalidPricingConfig(asset);
        primaryStaleness = config.primaryMaxStaleness;
        secondaryStaleness = config.secondaryMaxStaleness;
        primaryMode = OracleValidationMode.StandardChainlink;
        secondaryMode = config.secondaryValidationMode;
        marketRegistry.validateQuoteToken(
            quoteToken, config.secondarySource, secondaryStaleness, secondaryMode, true
        );
        _validateLeg(quoteToken, config.secondarySource, secondaryStaleness, secondaryMode);
        if (deployWrapper) {
            normalizedFeed = address(
                new UniswapV3RoutePriceFeed(
                    asset,
                    quoteToken,
                    IUniswapV3OraclePool(pool),
                    AggregatorV3Interface(config.secondarySource),
                    secondaryStaleness,
                    secondaryMode
                )
            );
            calculator.validatePriceFeed(
                asset, AggregatorV3Interface(normalizedFeed), primaryStaleness, primaryMode
            );
        }
        return (
            normalizedFeed,
            marketId,
            primaryStaleness,
            secondaryStaleness,
            primaryMode,
            secondaryMode
        );
    }

    function _requireMarketRegistry() private view {
        if (address(marketRegistry) == address(0)) revert MarketRegistryUnavailable();
    }

    function _validateLeg(
        address base,
        address feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) private view {
        if (feed.code.length == 0) revert InvalidPricingConfig(base);
        _validateMaxStaleness(maxStaleness);
        calculator.validatePriceFeed(
            base, AggregatorV3Interface(feed), maxStaleness, validationMode
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
        if (
            config.quoteToken != address(0) || config.secondarySource != address(0)
                || config.secondaryMaxStaleness != 0
                || config.secondaryValidationMode != OracleValidationMode.StandardChainlink
        ) revert InvalidPricingConfig(asset);
    }
}
