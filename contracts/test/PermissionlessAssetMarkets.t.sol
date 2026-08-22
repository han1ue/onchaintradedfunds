// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetMarketRegistry } from "../src/AssetMarketRegistry.sol";
import { AssetPricingResolver } from "../src/AssetPricingResolver.sol";
import { AssetRegistry } from "../src/AssetRegistry.sol";
import { ChainlinkRoutePriceFeed } from "../src/ChainlinkRoutePriceFeed.sol";
import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { RegisteredUniswapV3Adapter } from "../src/RegisteredUniswapV3Adapter.sol";
import { UniswapV3RoutePriceFeed } from "../src/UniswapV3RoutePriceFeed.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockReentrantToken } from "../src/mocks/MockReentrantToken.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockUniswapV3Router } from "../src/mocks/MockUniswapV3Router.sol";
import { AssetPricingConfig, PricingSource } from "../src/VaultTypes.sol";
import { TestBase } from "./TestBase.sol";

contract MockPermissionlessV3Pool {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    uint160 public sqrtPriceX96 = 1 << 96;
    int24 public tick;
    uint16 public observationCardinality = 64;
    uint16 public observationCardinalityNext = 64;
    bool public historyReady = true;

    constructor(address factory_, address tokenA, address tokenB, uint24 fee_) {
        factory = factory_;
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
    }

    function setTick(int24 tick_) external {
        tick = tick_;
    }

    function setHistoryReady(bool ready) external {
        historyReady = ready;
    }

    function setObservationCardinality(uint16 current, uint16 next) external {
        observationCardinality = current;
        observationCardinalityNext = next;
    }

    function increaseObservationCardinalityNext(uint16 target) external {
        if (target > observationCardinalityNext) observationCardinalityNext = target;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, tick, 0, observationCardinality, observationCardinalityNext, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory secondsPerLiquidity)
    {
        require(historyReady, "OLD");
        cumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidity = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            cumulatives[i] = int56(tick) * int56(uint56(block.timestamp - secondsAgos[i]));
        }
    }
}

contract MockPermissionlessV3Factory {
    mapping(bytes32 => address) private _pool;
    mapping(uint24 => int24) public feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[100] = 1;
        feeAmountTickSpacing[500] = 10;
        feeAmountTickSpacing[3_000] = 60;
    }

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (MockPermissionlessV3Pool pool)
    {
        pool = new MockPermissionlessV3Pool(address(this), tokenA, tokenB, fee);
        _pool[_key(tokenA, tokenB, fee)] = address(pool);
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return _pool[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address first, address second) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(first, second, fee));
    }
}

contract MockVaultPriceSources {
    address public immutable assetRegistry;
    address public assetMarketRegistry;
    mapping(address => address) public priceFeedForAsset;
    mapping(address => uint32) public maxStalenessForAsset;
    mapping(address => PricingSource) public pricingSourceForAsset;

    constructor(address assetRegistry_) {
        assetRegistry = assetRegistry_;
    }

    function setPriceFeed(address asset, address feed, uint32 maxStaleness, PricingSource source)
        external
    {
        priceFeedForAsset[asset] = feed;
        maxStalenessForAsset[asset] = maxStaleness;
        pricingSourceForAsset[asset] = source;
    }
}

contract PermissionlessAssetMarketsTest is TestBase {
    AssetRegistry private assets;
    AssetMarketRegistry private markets;
    MockPermissionlessV3Factory private v3Factory;
    MockStockToken private asset;
    MockStockToken private secondAsset;
    MockStockToken private weth;
    MockStockToken private usdg;
    MockPriceFeed private wethUsdFeed;
    MockPriceFeed private usdgUsdFeed;

    function setUp() public {
        vm.warp(1_700_000_000);
        assets = new AssetRegistry(address(this));
        asset = new MockStockToken("Permissionless Asset", "ASSET", 18);
        secondAsset = new MockStockToken("Second", "SECOND", 18);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);
        wethUsdFeed = new MockPriceFeed(8, 3_000_00000000);
        usdgUsdFeed = new MockPriceFeed(8, 1_00000000);
        v3Factory = new MockPermissionlessV3Factory();
        markets = new AssetMarketRegistry(
            address(this), address(v3Factory), address(weth), address(usdg)
        );
        markets.registerQuoteToken(address(weth), address(wethUsdFeed), 2 hours, true, true);
        markets.registerQuoteToken(address(usdg), address(usdgUsdFeed), 2 hours, true, true);
    }

    function testPermissionlessDiscoveryRegistrationHasNoGovernanceStatus() public {
        vm.prank(address(0xBEEF));
        assets.registerAsset(address(asset));
        assertTrue(assets.isRegisteredAsset(address(asset)));

        vm.expectPartialRevert(AssetRegistry.AssetAlreadyRegistered.selector);
        assets.registerAsset(address(asset));
    }

    function testDiscoveryRejectsNonEighteenDecimalAsset() public {
        MockStockToken sixDecimals = new MockStockToken("Six", "SIX", 6);
        vm.expectPartialRevert(AssetRegistry.UnsupportedAssetDecimals.selector);
        assets.registerAsset(address(sixDecimals));
    }

    function testRegistersMultiplePinnedCandidatesWithoutAnchorPool() public {
        MockPermissionlessV3Pool lowFee = v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool standardFee =
            v3Factory.createPool(address(asset), address(weth), 3_000);
        lowFee.setTick(-100);

        bytes32 first = markets.registerV3Market(address(asset), address(lowFee));
        bytes32 second = markets.registerV3Market(address(asset), address(standardFee));
        assertTrue(first != second);
        assertTrue(markets.isActiveMarketForAsset(first, address(asset)));
        assertTrue(markets.isActiveMarketForAsset(second, address(asset)));
        (address marketAsset, address marketPool, uint24 marketFee, bool active) =
            markets.marketFor(first);
        assertEq(marketAsset, address(asset));
        assertEq(marketPool, address(lowFee));
        assertEq(uint256(marketFee), 500);
        assertTrue(active);
        assertEq(uint256(lowFee.observationCardinality()), 64);
    }

    function testRegistersDirectAssetUsdgMarketAndPricesWithoutBridgeComposition() public {
        MockPermissionlessV3Pool directPool =
            v3Factory.createPool(address(asset), address(usdg), 500);
        directPool.setTick(-50);

        bytes32 marketId = markets.registerV3Market(address(asset), address(directPool));
        assertEq(markets.quoteTokenFor(marketId), address(usdg));
        (, address marketPool,, bool active) = markets.marketFor(marketId);
        assertEq(marketPool, address(directPool));
        assertTrue(active);
    }

    function testRejectsWrongPairAndRequiresReadyObservationsAtRegistration() public {
        MockPermissionlessV3Pool wrongPair =
            v3Factory.createPool(address(secondAsset), address(weth), 500);
        vm.expectPartialRevert(AssetMarketRegistry.InvalidPoolPair.selector);
        markets.registerV3Market(address(asset), address(wrongPair));

        MockPermissionlessV3Pool insufficientCapacity =
            v3Factory.createPool(address(asset), address(weth), 500);
        insufficientCapacity.setObservationCardinality(63, 64);
        vm.expectPartialRevert(AssetMarketRegistry.InsufficientObservationCapacity.selector);
        markets.registerV3Market(address(asset), address(insufficientCapacity));

        MockPermissionlessV3Pool insufficientHistory =
            v3Factory.createPool(address(asset), address(weth), 3_000);
        insufficientHistory.setHistoryReady(false);
        vm.expectPartialRevert(AssetMarketRegistry.InsufficientTwapHistory.selector);
        markets.registerV3Market(address(asset), address(insufficientHistory));
    }

    function testExecutionPathCanUsePoolDifferentFromPinnedPricingPool() public {
        MockPermissionlessV3Pool pricingPool =
            v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool executionPool =
            v3Factory.createPool(address(asset), address(weth), 3_000);
        bytes32 pricingMarketId = markets.registerV3Market(address(asset), address(pricingPool));
        (, address pinnedPool,,) = markets.marketFor(pricingMarketId);
        assertEq(pinnedPool, address(pricingPool));
        assertTrue(address(executionPool) != pinnedPool);

        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter adapter =
            new RegisteredUniswapV3Adapter(address(this), address(router));
        adapter.setCallerApproved(address(this), true);

        usdg.mint(address(adapter), 10 ether);
        asset.mint(address(router), 10 ether);
        bytes memory path = abi.encodePacked(
            address(usdg), bytes3(uint24(100)), address(weth), bytes3(uint24(3_000)), address(asset)
        );
        uint256 received =
            adapter.executeSwap(address(usdg), address(asset), 1 ether, 1 ether, path);
        assertEq(received, 1 ether);
        assertEq(keccak256(router.lastPath()), keccak256(path));
        assertEq(usdg.allowance(address(adapter), address(router)), 0);
        assertEq(usdg.balanceOf(address(adapter)), 9 ether);

        vm.expectPartialRevert(RegisteredUniswapV3Adapter.InvalidPath.selector);
        adapter.executeSwap(
            address(usdg),
            address(asset),
            1 ether,
            1 ether,
            abi.encodePacked(address(weth), bytes3(uint24(500)), address(asset))
        );
    }

    function testOneGenericAdapterSupportsAnyValidIntermediateRoute() public {
        MockPermissionlessV3Pool wethQuoted =
            v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool usdgQuoted =
            v3Factory.createPool(address(secondAsset), address(usdg), 3_000);
        markets.registerV3Market(address(asset), address(wethQuoted));
        markets.registerV3Market(address(secondAsset), address(usdgQuoted));
        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter adapter =
            new RegisteredUniswapV3Adapter(address(this), address(router));
        adapter.setCallerApproved(address(this), true);

        usdg.mint(address(adapter), 2 ether);
        weth.mint(address(adapter), 1 ether);
        asset.mint(address(router), 1 ether);
        secondAsset.mint(address(router), 2 ether);

        assertEq(
            adapter.executeSwap(
                address(usdg),
                address(asset),
                1 ether,
                1 ether,
                abi.encodePacked(
                    address(usdg),
                    bytes3(uint24(100)),
                    address(weth),
                    bytes3(uint24(500)),
                    address(asset)
                )
            ),
            1 ether
        );
        assertEq(
            keccak256(router.lastPath()),
            keccak256(
                abi.encodePacked(
                    address(usdg),
                    bytes3(uint24(100)),
                    address(weth),
                    bytes3(uint24(500)),
                    address(asset)
                )
            )
        );
        assertEq(
            adapter.executeSwap(
                address(usdg),
                address(secondAsset),
                1 ether,
                1 ether,
                abi.encodePacked(address(usdg), bytes3(uint24(3_000)), address(secondAsset))
            ),
            1 ether
        );
        assertEq(
            keccak256(router.lastPath()),
            keccak256(abi.encodePacked(address(usdg), bytes3(uint24(3_000)), address(secondAsset)))
        );
        assertEq(
            adapter.executeSwap(
                address(weth),
                address(secondAsset),
                1 ether,
                1 ether,
                abi.encodePacked(
                    address(weth),
                    bytes3(uint24(100)),
                    address(usdg),
                    bytes3(uint24(3_000)),
                    address(secondAsset)
                )
            ),
            1 ether
        );
        assertEq(
            keccak256(router.lastPath()),
            keccak256(
                abi.encodePacked(
                    address(weth),
                    bytes3(uint24(100)),
                    address(usdg),
                    bytes3(uint24(3_000)),
                    address(secondAsset)
                )
            )
        );

        MockStockToken arbitraryIntermediate = new MockStockToken("Route only", "ROUTE", 18);
        asset.mint(address(adapter), 1 ether);
        secondAsset.mint(address(router), 1 ether);
        bytes memory arbitraryPath = abi.encodePacked(
            address(asset),
            bytes3(uint24(250)),
            address(arbitraryIntermediate),
            bytes3(uint24(750)),
            address(secondAsset)
        );
        assertEq(
            adapter.executeSwap(
                address(asset), address(secondAsset), 1 ether, 1 ether, arbitraryPath
            ),
            1 ether
        );
        assertEq(keccak256(router.lastPath()), keccak256(arbitraryPath));
    }

    function testMixedRebalanceSettlesWethAndUsdgQuotedAssetsThroughUsdg() public {
        MockPermissionlessV3Pool wethQuoted =
            v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool usdgQuoted =
            v3Factory.createPool(address(secondAsset), address(usdg), 3_000);
        markets.registerV3Market(address(asset), address(wethQuoted));
        markets.registerV3Market(address(secondAsset), address(usdgQuoted));
        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter adapter =
            new RegisteredUniswapV3Adapter(address(this), address(router));
        adapter.setCallerApproved(address(this), true);

        asset.mint(address(adapter), 1 ether);
        usdg.mint(address(router), 1 ether);
        uint256 usdgReceived = adapter.executeSwap(
            address(asset),
            address(usdg),
            1 ether,
            1 ether,
            abi.encodePacked(
                address(asset),
                bytes3(uint24(500)),
                address(weth),
                bytes3(uint24(100)),
                address(usdg)
            )
        );
        assertEq(usdgReceived, 1 ether);
        assertEq(
            keccak256(router.lastPath()),
            keccak256(
                abi.encodePacked(
                    address(asset),
                    bytes3(uint24(500)),
                    address(weth),
                    bytes3(uint24(100)),
                    address(usdg)
                )
            )
        );

        usdg.transfer(address(adapter), usdgReceived);
        secondAsset.mint(address(router), usdgReceived);
        uint256 assetReceived = adapter.executeSwap(
            address(usdg),
            address(secondAsset),
            usdgReceived,
            usdgReceived,
            abi.encodePacked(address(usdg), bytes3(uint24(3_000)), address(secondAsset))
        );
        assertEq(assetReceived, usdgReceived);
        assertEq(
            keccak256(router.lastPath()),
            keccak256(abi.encodePacked(address(usdg), bytes3(uint24(3_000)), address(secondAsset)))
        );
        assertEq(usdg.allowance(address(adapter), address(router)), 0);
    }

    function testResolverPinsReadyV3PoolAndDeprecationDoesNotDisableFeed() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);
        MockPermissionlessV3Pool pool = v3Factory.createPool(address(asset), address(weth), 500);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.UniswapV3Twap,
            quoteToken: address(weth),
            primarySource: address(pool),
            primaryMaxStaleness: 2 hours
        });

        (address normalizedFeed, bytes32 marketId, uint32 maxStaleness) =
            resolver.resolvePricing(address(asset), config);
        assertTrue(normalizedFeed.code.length != 0);
        assertTrue(markets.isActiveMarketForAsset(marketId, address(asset)));
        assertEq(uint256(maxStaleness), 2 hours);

        markets.setMarketActive(marketId, false);
        (, int256 answer,,,) = UniswapV3RoutePriceFeed(normalizedFeed).latestRoundData();
        assertEq(uint256(answer), 3_000_00000000);
    }

    function testResolverComposesPinnedAssetFeedWithCurrentQuoteFeed() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);
        MockPriceFeed assetWethFeed = new MockPriceFeed(18, 2 ether);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetQuote,
            quoteToken: address(weth),
            primarySource: address(assetWethFeed),
            primaryMaxStaleness: 4 hours
        });

        (address normalizedFeed, bytes32 marketId, uint32 primaryStaleness) =
            resolver.resolvePricing(address(asset), config);
        assertEq(marketId, bytes32(0));
        assertEq(uint256(primaryStaleness), 4 hours);
        (, int256 answer,,,) = ChainlinkRoutePriceFeed(normalizedFeed).latestRoundData();
        assertEq(uint256(answer), 6_000_00000000);

        new MockPriceFeed(18, 1 ether);
        (, int256 pinnedAnswer,,,) = ChainlinkRoutePriceFeed(normalizedFeed).latestRoundData();
        assertEq(uint256(pinnedAnswer), 6_000_00000000);
    }

    function testRegisteredQuotesSupportUsdg() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);

        MockPriceFeed assetUsdgFeed = new MockPriceFeed(8, 4_00000000);
        AssetPricingConfig memory usdgComposed = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetQuote,
            quoteToken: address(usdg),
            primarySource: address(assetUsdgFeed),
            primaryMaxStaleness: 2 hours
        });
        (address usdgNormalized,,) = resolver.resolvePricing(address(asset), usdgComposed);
        (, int256 usdgAnswer,,,) = ChainlinkRoutePriceFeed(usdgNormalized).latestRoundData();
        assertEq(uint256(usdgAnswer), 4_00000000);

        MockPermissionlessV3Pool usdgPool =
            v3Factory.createPool(address(secondAsset), address(usdg), 500);
        // Token1 has 18 decimals and token0 has 6, so a whole-token 1:1 price requires a
        // raw-unit ratio near 1e12 rather than tick zero.
        usdgPool.setTick(276_324);
        AssetPricingConfig memory usdgV3 = AssetPricingConfig({
            source: PricingSource.UniswapV3Twap,
            quoteToken: address(usdg),
            primarySource: address(usdgPool),
            primaryMaxStaleness: 2 hours
        });
        (address usdgV3Feed,,) = resolver.resolvePricing(address(secondAsset), usdgV3);
        (, int256 usdgV3Answer,,,) = UniswapV3RoutePriceFeed(usdgV3Feed).latestRoundData();
        assertApproxEqAbs(uint256(usdgV3Answer), 1_00000000, 10_000);
    }

    function testAdminAddedQuoteSupportsComposedAndV3AndUpdatesExistingRoutes() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);

        MockStockToken thirdQuote = new MockStockToken("Third Quote", "THIRD", 18);
        MockPriceFeed thirdUsdFeed = new MockPriceFeed(8, 2_00000000);
        markets.registerQuoteToken(address(thirdQuote), address(thirdUsdFeed), 2 hours, true, true);
        MockPriceFeed assetThirdFeed = new MockPriceFeed(18, 3 ether);
        AssetPricingConfig memory thirdComposed = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetQuote,
            quoteToken: address(thirdQuote),
            primarySource: address(assetThirdFeed),
            primaryMaxStaleness: 2 hours
        });
        (address pinnedThirdFeed,,) = resolver.resolvePricing(address(asset), thirdComposed);
        (, int256 thirdAnswer,,,) = ChainlinkRoutePriceFeed(pinnedThirdFeed).latestRoundData();
        assertEq(uint256(thirdAnswer), 6_00000000);

        MockPermissionlessV3Pool thirdPool =
            v3Factory.createPool(address(secondAsset), address(thirdQuote), 500);
        AssetPricingConfig memory thirdV3 = AssetPricingConfig({
            source: PricingSource.UniswapV3Twap,
            quoteToken: address(thirdQuote),
            primarySource: address(thirdPool),
            primaryMaxStaleness: 2 hours
        });
        (address thirdV3Feed,,) = resolver.resolvePricing(address(secondAsset), thirdV3);
        assertTrue(thirdV3Feed.code.length != 0);

        markets.setQuoteTokenEnabled(address(thirdQuote), false);
        vm.expectPartialRevert(AssetMarketRegistry.QuoteTokenConfigMismatch.selector);
        resolver.validatePricing(address(asset), thirdComposed);
        (, int256 stillPinned,,,) = ChainlinkRoutePriceFeed(pinnedThirdFeed).latestRoundData();
        assertEq(uint256(stillPinned), 6_00000000);

        MockPriceFeed replacementThirdUsd = new MockPriceFeed(8, 9_00000000);
        markets.registerQuoteToken(
            address(thirdQuote), address(replacementThirdUsd), 1 hours, true, true
        );
        (address replacementNormalized,,) = resolver.resolvePricing(address(asset), thirdComposed);
        (, int256 replacementAnswer,,,) =
            ChainlinkRoutePriceFeed(replacementNormalized).latestRoundData();
        assertEq(uint256(replacementAnswer), 27_00000000);
        (, int256 updatedExistingRoute,,,) =
            ChainlinkRoutePriceFeed(pinnedThirdFeed).latestRoundData();
        assertEq(uint256(updatedExistingRoute), 27_00000000);
    }

    function testQuoteFeedReplacementMustAlreadyBeValid() public {
        MockPriceFeed invalidFeed = new MockPriceFeed(8, 1_00000000);
        invalidFeed.setRoundData(2, 0, block.timestamp, block.timestamp, 2);

        vm.expectPartialRevert(AssetMarketRegistry.InvalidOraclePrice.selector);
        markets.registerQuoteToken(address(weth), address(invalidFeed), 1 hours, true, true);
    }

    function testResolverRejectsUnregisteredAndDisabledQuoteToken() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);
        MockStockToken unknownQuote = new MockStockToken("Unknown", "UNKNOWN", 18);
        MockPriceFeed primary = new MockPriceFeed(18, 1 ether);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetQuote,
            quoteToken: address(unknownQuote),
            primarySource: address(primary),
            primaryMaxStaleness: 2 hours
        });
        vm.expectPartialRevert(AssetMarketRegistry.QuoteTokenConfigNotFound.selector);
        resolver.validatePricing(address(asset), config);

        config.quoteToken = address(weth);
        markets.setQuoteTokenEnabled(address(weth), false);
        vm.expectPartialRevert(AssetMarketRegistry.QuoteTokenConfigMismatch.selector);
        resolver.validatePricing(address(asset), config);
    }

    function testResolverAcceptsAnyMechanicallyValidDirectFeed() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);
        MockPriceFeed suppliedFeed = new MockPriceFeed(8, 101_00000000);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.ChainlinkDirect,
            quoteToken: address(0),
            primarySource: address(suppliedFeed),
            primaryMaxStaleness: 25 hours
        });

        resolver.validatePricing(address(asset), config);
    }

    function testRobinhoodValidationRequiresOraclePausedFunction() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);
        MockReentrantToken tokenWithoutPause =
            new MockReentrantToken("No pause status", "NOPAUSE", 18);
        MockPriceFeed feed = new MockPriceFeed(8, 100_00000000);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.RobinhoodDirect,
            quoteToken: address(0),
            primarySource: address(feed),
            primaryMaxStaleness: 1 hours
        });

        vm.expectPartialRevert(PortfolioCalculator.OraclePauseStatusUnavailable.selector);
        resolver.validatePricing(address(tokenWithoutPause), config);
    }

    function testResolverRejectsInvalidStaleAndPausedChainlinkFeeds() public {
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(markets, calculator);

        MockPriceFeed directFeed = new MockPriceFeed(8, 100_00000000);
        AssetPricingConfig memory direct = AssetPricingConfig({
            source: PricingSource.ChainlinkDirect,
            quoteToken: address(0),
            primarySource: address(directFeed),
            primaryMaxStaleness: 1 hours
        });

        directFeed.setRoundData(
            2, 100_00000000, block.timestamp - 1 hours - 1, block.timestamp - 1 hours - 1, 2
        );
        vm.expectPartialRevert(PortfolioCalculator.StaleOraclePrice.selector);
        resolver.validatePricing(address(asset), direct);

        directFeed.setRoundData(3, 0, block.timestamp, block.timestamp, 3);
        vm.expectPartialRevert(PortfolioCalculator.InvalidOraclePrice.selector);
        resolver.validatePricing(address(asset), direct);

        directFeed.setRoundData(4, 100_00000000, block.timestamp, block.timestamp + 1, 4);
        vm.expectPartialRevert(PortfolioCalculator.InvalidOracleTimestamp.selector);
        resolver.validatePricing(address(asset), direct);

        directFeed.setRoundData(5, 100_00000000, block.timestamp, block.timestamp, 4);
        vm.expectPartialRevert(PortfolioCalculator.IncompleteOracleRound.selector);
        resolver.validatePricing(address(asset), direct);

        directFeed.setRoundData(6, 100_00000000, block.timestamp, block.timestamp, 6);
        asset.setOraclePaused(true);
        direct.source = PricingSource.RobinhoodDirect;
        vm.expectPartialRevert(PortfolioCalculator.OraclePaused.selector);
        resolver.validatePricing(address(asset), direct);

        asset.setOraclePaused(false);
        MockPriceFeed unsupportedDecimals = new MockPriceFeed(37, 100_00000000);
        direct.primarySource = address(unsupportedDecimals);
        direct.source = PricingSource.ChainlinkDirect;
        vm.expectPartialRevert(PortfolioCalculator.UnsupportedDecimals.selector);
        resolver.validatePricing(address(asset), direct);

        direct.primarySource = address(directFeed);
        direct.primaryMaxStaleness = 0;
        vm.expectPartialRevert(AssetPricingResolver.InvalidMaxStaleness.selector);
        resolver.validatePricing(address(asset), direct);

        direct.primaryMaxStaleness = 7 days + 1;
        vm.expectPartialRevert(AssetPricingResolver.MaxStalenessTooHigh.selector);
        resolver.validatePricing(address(asset), direct);
    }

    function testPortfolioCalculatorUsesPinnedFeed() public {
        MockPriceFeed pinnedFeed = new MockPriceFeed(8, 150_00000000);

        MockVaultPriceSources vault = new MockVaultPriceSources(address(assets));
        vault.setPriceFeed(
            address(asset), address(pinnedFeed), 25 hours, PricingSource.ChainlinkDirect
        );
        PortfolioCalculator calculator = new PortfolioCalculator();

        uint256 pinnedValue = calculator.assetValueForVault(address(vault), address(asset), 1 ether);
        assertEq(pinnedValue, 150 ether);

        vault.setPriceFeed(address(asset), address(0), 25 hours, PricingSource.ChainlinkDirect);
        vm.expectPartialRevert(PortfolioCalculator.OracleFeedMissing.selector);
        calculator.assetValueForVault(address(vault), address(asset), 1 ether);
    }
}
