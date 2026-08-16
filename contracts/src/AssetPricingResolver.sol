// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ChainlinkRoutePriceFeed } from "./ChainlinkRoutePriceFeed.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { IOracleRegistry, OracleValidationMode } from "./interfaces/IOracleRegistry.sol";
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

/// @notice Validates user-supplied oracle identity and resolves a normalized per-vault price feed.
/// @dev Trusted mappings are consulted only during selection. Returned feeds are pinned by the vault.
contract AssetPricingResolver is IAssetPricingResolver {
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidPricingConfig(address asset);
    error MarketRegistryUnavailable();
    error PriceFeedMismatch(address asset, address expected, address supplied);
    error InvalidAssetMarket(address asset, bytes32 marketId);

    IOracleRegistry public immutable trustedOracles;
    IAssetMarketRegistry public immutable marketRegistry;
    PortfolioCalculator public immutable calculator;

    constructor(
        IOracleRegistry trustedOracles_,
        IAssetMarketRegistry marketRegistry_,
        PortfolioCalculator calculator_
    ) {
        if (address(trustedOracles_) == address(0) || address(calculator_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(trustedOracles_).code.length == 0) {
            revert InvalidDependency(address(trustedOracles_));
        }
        if (address(marketRegistry_) != address(0) && address(marketRegistry_).code.length == 0) {
            revert InvalidDependency(address(marketRegistry_));
        }
        if (address(calculator_).code.length == 0) {
            revert InvalidDependency(address(calculator_));
        }
        trustedOracles = trustedOracles_;
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
            if (config.secondarySource != address(0)) revert InvalidPricingConfig(asset);
            AggregatorV3Interface expected;
            (expected, primaryStaleness, primaryMode) =
                trustedOracles.oracleConfigForPair(asset, trustedOracles.usdQuote());
            if (address(expected) != config.primarySource) {
                revert PriceFeedMismatch(asset, address(expected), config.primarySource);
            }
            calculator.validatePriceFeed(asset, expected, primaryStaleness, primaryMode);
            return (
                config.primarySource,
                bytes32(0),
                primaryStaleness,
                0,
                primaryMode,
                OracleValidationMode.StandardChainlink
            );
        }

        if (config.source == PricingSource.ChainlinkAssetWeth) {
            if (config.secondarySource.code.length == 0) revert InvalidPricingConfig(asset);
            _requireMarketRegistry();
            address weth = marketRegistry.weth();
            AggregatorV3Interface expectedPrimary;
            AggregatorV3Interface expectedSecondary;
            (expectedPrimary, primaryStaleness, primaryMode) =
                trustedOracles.oracleConfigForPair(asset, weth);
            (expectedSecondary, secondaryStaleness, secondaryMode) =
                trustedOracles.oracleConfigForPair(weth, trustedOracles.usdQuote());
            if (address(expectedPrimary) != config.primarySource) {
                revert PriceFeedMismatch(asset, address(expectedPrimary), config.primarySource);
            }
            if (address(expectedSecondary) != config.secondarySource) {
                revert PriceFeedMismatch(asset, address(expectedSecondary), config.secondarySource);
            }
            calculator.validatePriceFeed(asset, expectedPrimary, primaryStaleness, primaryMode);
            calculator.validatePriceFeed(weth, expectedSecondary, secondaryStaleness, secondaryMode);
            if (deployWrapper) {
                normalizedFeed = address(
                    new ChainlinkRoutePriceFeed(
                        asset,
                        weth,
                        expectedPrimary,
                        expectedSecondary,
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

        if (config.secondarySource != address(0)) revert InvalidPricingConfig(asset);
        _requireMarketRegistry();
        marketId = marketRegistry.registerV3Market(asset, config.primarySource);
        (address marketAsset, address pool, address priceFeed,, bool active) =
            marketRegistry.marketFor(marketId);
        if (
            !active || marketAsset != asset || pool != config.primarySource
                || priceFeed.code.length == 0
        ) revert InvalidAssetMarket(asset, marketId);
        primaryStaleness = 2 hours;
        primaryMode = OracleValidationMode.StandardChainlink;
        calculator.validatePriceFeed(
            asset, AggregatorV3Interface(priceFeed), primaryStaleness, primaryMode
        );
        return (priceFeed, marketId, primaryStaleness, 0, primaryMode, primaryMode);
    }

    function _requireMarketRegistry() private view {
        if (address(marketRegistry) == address(0)) revert MarketRegistryUnavailable();
    }
}
