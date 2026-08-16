// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetMarketRegistry } from "../src/AssetMarketRegistry.sol";
import { AssetRegistry } from "../src/AssetRegistry.sol";
import { OracleRegistry } from "../src/OracleRegistry.sol";
import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { RegisteredUniswapV3Adapter } from "../src/RegisteredUniswapV3Adapter.sol";
import { UniswapV3RoutePriceFeed } from "../src/UniswapV3RoutePriceFeed.sol";
import { AssetStatus } from "../src/interfaces/IAssetRegistry.sol";
import { OracleValidationMode } from "../src/interfaces/IOracleRegistry.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockUniswapV3Router } from "../src/mocks/MockUniswapV3Router.sol";
import { TestBase } from "./TestBase.sol";

contract MockPermissionlessV3Pool {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    uint160 public sqrtPriceX96 = 1 << 96;
    int24 public tick;
    uint16 public observationCardinality = 2;
    uint16 public observationCardinalityNext = 2;
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

    function increaseObservationCardinalityNext(uint16 target) external {
        if (target > observationCardinalityNext) observationCardinalityNext = target;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (
            sqrtPriceX96,
            tick,
            0,
            observationCardinality,
            observationCardinalityNext,
            0,
            true
        );
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

    constructor(address assetRegistry_) {
        assetRegistry = assetRegistry_;
    }

    function setPriceFeed(address asset, address feed) external {
        priceFeedForAsset[asset] = feed;
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
        asset = new MockStockToken("Open Asset", "OPEN", 18);
        secondAsset = new MockStockToken("Second", "SECOND", 18);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);
        v3Factory = new MockPermissionlessV3Factory();
        bridgePool = v3Factory.createPool(address(weth), address(usdg), 100);
        markets = new AssetMarketRegistry(
            address(this), address(v3Factory), address(weth), address(usdg), address(bridgePool)
        );
    }

    function testOpenRegistrationAndGovernanceStatuses() public {
        vm.prank(address(0xBEEF));
        assets.registerOpenAsset(address(asset));
        assertEq(uint256(assets.statusOf(address(asset))), uint256(AssetStatus.Open));
        assertTrue(assets.canBeConstituent(address(asset)));
        assertFalse(assets.isQualifiedAsset(address(asset)));

        assets.setAssetStatus(address(asset), AssetStatus.Qualified);
        assertTrue(assets.isQualifiedAsset(address(asset)));
        assets.setAssetStatus(address(asset), AssetStatus.Blocked);
        assertFalse(assets.canBeConstituent(address(asset)));
    }

    function testRejectsNonEighteenDecimalOpenAsset() public {
        MockStockToken sixDecimals = new MockStockToken("Six", "SIX", 6);
        vm.expectPartialRevert(AssetRegistry.UnsupportedAssetDecimals.selector);
        assets.registerOpenAsset(address(sixDecimals));
    }

    function testRegistersMultiplePinnedCandidatesAndComposesTwap() public {
        MockPermissionlessV3Pool lowFee =
            v3Factory.createPool(address(asset), address(weth), 500);
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
        assertEq(uint256(lowFee.observationCardinalityNext()), 64);
    }

    function testRejectsWrongPairAndInsufficientHistory() public {
        MockPermissionlessV3Pool wrongPair =
            v3Factory.createPool(address(secondAsset), address(weth), 500);
        vm.expectPartialRevert(AssetMarketRegistry.InvalidPoolPair.selector);
        markets.registerV3Market(address(asset), address(wrongPair));

        MockPermissionlessV3Pool valid =
            v3Factory.createPool(address(asset), address(weth), 500);
        bytes32 marketId = markets.registerV3Market(address(asset), address(valid));
        (,, address feed,,) = markets.marketFor(marketId);
        valid.setHistoryReady(false);
        vm.expectRevert();
        UniswapV3RoutePriceFeed(feed).latestRoundData();
    }

    function testRegisteredAdapterUsesPinnedRoutesAndClearsApproval() public {
        MockPermissionlessV3Pool pool =
            v3Factory.createPool(address(asset), address(weth), 500);
        bytes32 marketId = markets.registerV3Market(address(asset), address(pool));
        MockUniswapV3Router router = new MockUniswapV3Router();
        RegisteredUniswapV3Adapter adapter = new RegisteredUniswapV3Adapter(
            address(this), address(router), markets, address(usdg)
        );
        adapter.setCallerApproved(address(this), true);

        usdg.mint(address(adapter), 10 ether);
        asset.mint(address(router), 10 ether);
        uint256 received = adapter.executeSwap(
            address(usdg), address(asset), 1 ether, 1 ether, abi.encode(marketId)
        );
        assertEq(received, 1 ether);
        assertEq(usdg.allowance(address(adapter), address(router)), 0);
        assertEq(usdg.balanceOf(address(adapter)), 9 ether);

        vm.expectPartialRevert(RegisteredUniswapV3Adapter.InvalidMarket.selector);
        adapter.executeSwap(
            address(usdg), address(asset), 1 ether, 1 ether, abi.encode(bytes32(uint256(1)))
        );
    }

    function testQualifiedUsesProtocolOracleWhileOpenRequiresPinnedFeed() public {
        assets.setAssetStatus(address(asset), AssetStatus.Qualified);
        OracleRegistry oracles = new OracleRegistry(address(this));
        MockPriceFeed qualifiedFeed = new MockPriceFeed(8, 100_00000000);
        oracles.setOracleConfig(
            address(asset),
            qualifiedFeed,
            25 hours,
            OracleValidationMode.StandardChainlink
        );

        MockPermissionlessV3Pool pool =
            v3Factory.createPool(address(asset), address(weth), 500);
        bytes32 marketId = markets.registerV3Market(address(asset), address(pool));
        (,, address routeFeed,,) = markets.marketFor(marketId);
        MockVaultPriceSources vault = new MockVaultPriceSources(address(assets));
        vault.setPriceFeed(address(asset), routeFeed);
        PortfolioCalculator calculator = new PortfolioCalculator();

        uint256 qualifiedValue = calculator.assetValueForVault(
            address(vault), address(asset), 1 ether, address(oracles)
        );
        assertEq(qualifiedValue, 100 ether);

        assets.setAssetStatus(address(asset), AssetStatus.Open);
        uint256 openValue = calculator.assetValueForVault(
            address(vault), address(asset), 1 ether, address(oracles)
        );
        assertTrue(openValue != qualifiedValue);

        vault.setPriceFeed(address(asset), address(0));
        vm.expectPartialRevert(PortfolioCalculator.OracleFeedMissing.selector);
        calculator.assetValueForVault(address(vault), address(asset), 1 ether, address(oracles));
    }
}
