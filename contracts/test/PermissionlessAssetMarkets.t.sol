// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetMarketRegistry } from "../src/AssetMarketRegistry.sol";
import { AssetPricingResolver } from "../src/AssetPricingResolver.sol";
import { AssetRegistry } from "../src/AssetRegistry.sol";
import { ChainlinkRoutePriceFeed } from "../src/ChainlinkRoutePriceFeed.sol";
import { OracleRegistry } from "../src/OracleRegistry.sol";
import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { RegisteredUniswapV3Adapter } from "../src/RegisteredUniswapV3Adapter.sol";
import { UniswapV3RoutePriceFeed } from "../src/UniswapV3RoutePriceFeed.sol";
import { OracleValidationMode } from "../src/interfaces/IOracleRegistry.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
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
    mapping(address => OracleValidationMode) public oracleValidationModeForAsset;

    constructor(address assetRegistry_) {
        assetRegistry = assetRegistry_;
    }

    function setPriceFeed(
        address asset,
        address feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) external {
        priceFeedForAsset[asset] = feed;
        maxStalenessForAsset[asset] = maxStaleness;
        oracleValidationModeForAsset[asset] = validationMode;
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
    MockPermissionlessV3Pool private bridgePool;

    function setUp() public {
        vm.warp(1_700_000_000);
        assets = new AssetRegistry(address(this));
        asset = new MockStockToken("Permissionless Asset", "ASSET", 18);
        secondAsset = new MockStockToken("Second", "SECOND", 18);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);
        v3Factory = new MockPermissionlessV3Factory();
        bridgePool = v3Factory.createPool(address(weth), address(usdg), 100);
        markets = new AssetMarketRegistry(
            address(this), address(v3Factory), address(weth), address(usdg), address(bridgePool)
        );
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

    function testRegistersMultiplePinnedCandidatesAndComposesTwap() public {
        MockPermissionlessV3Pool lowFee = v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool standardFee =
            v3Factory.createPool(address(asset), address(weth), 3_000);
        lowFee.setTick(-100);
        bridgePool.setTick(75);

        bytes32 first = markets.registerV3Market(address(asset), address(lowFee));
        bytes32 second = markets.registerV3Market(address(asset), address(standardFee));
        assertTrue(first != second);
        assertTrue(markets.isActiveMarketForAsset(first, address(asset)));
        assertTrue(markets.isActiveMarketForAsset(second, address(asset)));
        (,, address feed,,) = markets.marketFor(first);
        (, int256 answer,, uint256 updatedAt,) = UniswapV3RoutePriceFeed(feed).latestRoundData();
        assertGt(uint256(answer), 0);
        assertEq(updatedAt, block.timestamp);
        assertEq(uint256(lowFee.observationCardinality()), 64);
    }

    function testRegistersDirectAssetUsdgMarketAndPricesWithoutBridgeComposition() public {
        MockPermissionlessV3Pool directPool =
            v3Factory.createPool(address(asset), address(usdg), 500);
        directPool.setTick(-50);

        bytes32 marketId = markets.registerV3Market(address(asset), address(directPool));
        assertEq(markets.quoteTokenFor(marketId), address(usdg));
        (,, address feed,,) = markets.marketFor(marketId);
        assertEq(UniswapV3RoutePriceFeed(feed).quoteToken(), address(usdg));
        (, int256 answer,, uint256 updatedAt,) = UniswapV3RoutePriceFeed(feed).latestRoundData();
        assertGt(uint256(answer), 0);
        assertEq(updatedAt, block.timestamp);
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
        (, address pinnedPool,,,) = markets.marketFor(pricingMarketId);
        assertEq(pinnedPool, address(pricingPool));
        assertTrue(address(executionPool) != pinnedPool);

        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter adapter =
            new RegisteredUniswapV3Adapter(address(this), address(router), address(usdg));
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

    function testRegisteredAdaptersSupportBothPoolQuoteTokens() public {
        MockPermissionlessV3Pool wethQuoted =
            v3Factory.createPool(address(asset), address(weth), 500);
        MockPermissionlessV3Pool usdgQuoted =
            v3Factory.createPool(address(secondAsset), address(usdg), 3_000);
        markets.registerV3Market(address(asset), address(wethQuoted));
        markets.registerV3Market(address(secondAsset), address(usdgQuoted));
        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter usdgAdapter =
            new RegisteredUniswapV3Adapter(address(this), address(router), address(usdg));
        RegisteredUniswapV3Adapter wethAdapter =
            new RegisteredUniswapV3Adapter(address(this), address(router), address(weth));
        usdgAdapter.setCallerApproved(address(this), true);
        wethAdapter.setCallerApproved(address(this), true);

        usdg.mint(address(usdgAdapter), 2 ether);
        weth.mint(address(wethAdapter), 1 ether);
        asset.mint(address(router), 1 ether);
        secondAsset.mint(address(router), 2 ether);

        assertEq(
            usdgAdapter.executeSwap(
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
            usdgAdapter.executeSwap(
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
            wethAdapter.executeSwap(
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
            new RegisteredUniswapV3Adapter(address(this), address(router), address(usdg));
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
        OracleRegistry oracles = new OracleRegistry(address(this));
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(oracles, markets, calculator);
        MockPermissionlessV3Pool pool = v3Factory.createPool(address(asset), address(weth), 500);
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.UniswapV3Twap,
            primarySource: address(pool),
            secondarySource: address(0)
        });

        (
            address normalizedFeed,
            bytes32 marketId,
            uint32 maxStaleness,,
            OracleValidationMode mode,
        ) = resolver.resolvePricing(address(asset), config);
        assertTrue(normalizedFeed.code.length != 0);
        assertTrue(markets.isActiveMarketForAsset(marketId, address(asset)));
        assertEq(uint256(maxStaleness), 2 hours);
        assertEq(uint256(mode), uint256(OracleValidationMode.StandardChainlink));

        markets.setMarketActive(marketId, false);
        (, int256 answer,,,) = UniswapV3RoutePriceFeed(normalizedFeed).latestRoundData();
        assertGt(uint256(answer), 0);
    }

    function testResolverComposesAndPinsTrustedChainlinkLegs() public {
        OracleRegistry oracles = new OracleRegistry(address(this));
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(oracles, markets, calculator);
        MockPriceFeed assetWethFeed = new MockPriceFeed(18, 2 ether);
        MockPriceFeed wethUsdFeed = new MockPriceFeed(8, 3_000_00000000);
        oracles.setOracleRoute(
            address(asset),
            address(weth),
            assetWethFeed,
            4 hours,
            OracleValidationMode.StandardChainlink
        );
        oracles.setOracleRoute(
            address(weth),
            oracles.usdQuote(),
            wethUsdFeed,
            2 hours,
            OracleValidationMode.StandardChainlink
        );
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetWeth,
            primarySource: address(assetWethFeed),
            secondarySource: address(wethUsdFeed)
        });

        (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness,
            uint32 secondaryStaleness,
            OracleValidationMode primaryMode,
            OracleValidationMode secondaryMode
        ) = resolver.resolvePricing(address(asset), config);
        assertEq(marketId, bytes32(0));
        assertEq(uint256(primaryStaleness), 4 hours);
        assertEq(uint256(secondaryStaleness), 2 hours);
        assertEq(uint256(primaryMode), uint256(OracleValidationMode.StandardChainlink));
        assertEq(uint256(secondaryMode), uint256(OracleValidationMode.StandardChainlink));
        (, int256 answer,,,) = ChainlinkRoutePriceFeed(normalizedFeed).latestRoundData();
        assertEq(uint256(answer), 6_000_00000000);

        MockPriceFeed replacementAssetWethFeed = new MockPriceFeed(18, 1 ether);
        oracles.setOracleRoute(
            address(asset),
            address(weth),
            replacementAssetWethFeed,
            1 hours,
            OracleValidationMode.StandardChainlink
        );
        (, int256 pinnedAnswer,,,) = ChainlinkRoutePriceFeed(normalizedFeed).latestRoundData();
        assertEq(uint256(pinnedAnswer), 6_000_00000000);
    }

    function testResolverRejectsUntrustedDirectFeed() public {
        OracleRegistry oracles = new OracleRegistry(address(this));
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(oracles, markets, calculator);
        MockPriceFeed trustedFeed = new MockPriceFeed(8, 100_00000000);
        MockPriceFeed suppliedFeed = new MockPriceFeed(8, 101_00000000);
        oracles.setOracleConfig(
            address(asset), trustedFeed, 25 hours, OracleValidationMode.StandardChainlink
        );
        AssetPricingConfig memory config = AssetPricingConfig({
            source: PricingSource.ChainlinkDirect,
            primarySource: address(suppliedFeed),
            secondarySource: address(0)
        });

        vm.expectPartialRevert(AssetPricingResolver.PriceFeedMismatch.selector);
        resolver.validatePricing(address(asset), config);
    }

    function testResolverRejectsReverseStaleInvalidAndPausedChainlinkFeeds() public {
        OracleRegistry oracles = new OracleRegistry(address(this));
        PortfolioCalculator calculator = new PortfolioCalculator();
        AssetPricingResolver resolver = new AssetPricingResolver(oracles, markets, calculator);
        MockPriceFeed reverseFeed = new MockPriceFeed(8, 100_00000000);
        MockPriceFeed wethUsdFeed = new MockPriceFeed(8, 3_000_00000000);
        oracles.setOracleRoute(
            address(weth),
            address(asset),
            reverseFeed,
            1 hours,
            OracleValidationMode.StandardChainlink
        );
        oracles.setOracleRoute(
            address(weth),
            oracles.usdQuote(),
            wethUsdFeed,
            1 hours,
            OracleValidationMode.StandardChainlink
        );
        AssetPricingConfig memory composed = AssetPricingConfig({
            source: PricingSource.ChainlinkAssetWeth,
            primarySource: address(reverseFeed),
            secondarySource: address(wethUsdFeed)
        });
        vm.expectPartialRevert(AssetPricingResolver.PriceFeedMismatch.selector);
        resolver.validatePricing(address(asset), composed);

        MockPriceFeed directFeed = new MockPriceFeed(8, 100_00000000);
        AssetPricingConfig memory direct = AssetPricingConfig({
            source: PricingSource.ChainlinkDirect,
            primarySource: address(directFeed),
            secondarySource: address(0)
        });
        oracles.setOracleConfig(
            address(asset), directFeed, 1 hours, OracleValidationMode.StandardChainlink
        );

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
        oracles.setOracleConfig(
            address(asset), directFeed, 1 hours, OracleValidationMode.RobinhoodStockToken
        );
        vm.expectPartialRevert(PortfolioCalculator.OraclePaused.selector);
        resolver.validatePricing(address(asset), direct);

        asset.setOraclePaused(false);
        MockPriceFeed unsupportedDecimals = new MockPriceFeed(37, 100_00000000);
        oracles.setOracleConfig(
            address(asset), unsupportedDecimals, 1 hours, OracleValidationMode.StandardChainlink
        );
        direct.primarySource = address(unsupportedDecimals);
        vm.expectPartialRevert(PortfolioCalculator.UnsupportedDecimals.selector);
        resolver.validatePricing(address(asset), direct);
    }

    function testPortfolioCalculatorUsesPinnedFeedAfterRegistryChanges() public {
        OracleRegistry oracles = new OracleRegistry(address(this));
        MockPriceFeed registryFeed = new MockPriceFeed(8, 100_00000000);
        MockPriceFeed pinnedFeed = new MockPriceFeed(8, 150_00000000);
        oracles.setOracleConfig(
            address(asset), registryFeed, 25 hours, OracleValidationMode.StandardChainlink
        );

        MockVaultPriceSources vault = new MockVaultPriceSources(address(assets));
        vault.setPriceFeed(
            address(asset), address(pinnedFeed), 25 hours, OracleValidationMode.StandardChainlink
        );
        PortfolioCalculator calculator = new PortfolioCalculator();

        uint256 pinnedValue = calculator.assetValueForVault(
            address(vault), address(asset), 1 ether, address(oracles)
        );
        assertEq(pinnedValue, 150 ether);

        MockPriceFeed replacementFeed = new MockPriceFeed(8, 200_00000000);
        oracles.setOracleConfig(
            address(asset), replacementFeed, 25 hours, OracleValidationMode.StandardChainlink
        );
        uint256 valueAfterRegistryChange = calculator.assetValueForVault(
            address(vault), address(asset), 1 ether, address(oracles)
        );
        assertEq(valueAfterRegistryChange, pinnedValue);

        vault.setPriceFeed(
            address(asset), address(0), 25 hours, OracleValidationMode.StandardChainlink
        );
        vm.expectPartialRevert(PortfolioCalculator.OracleFeedMissing.selector);
        calculator.assetValueForVault(address(vault), address(asset), 1 ether, address(oracles));
    }
}
