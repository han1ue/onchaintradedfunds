// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import {
    INonfungiblePositionManagerMarket,
    OTFV3MarketRegistry
} from "../src/OTFV3MarketRegistry.sol";
import { MockOfficialMarketRegistry } from "../src/mocks/MockOfficialMarketRegistry.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    uint160 public sqrtPriceX96;
    uint128 public liquidity;

    constructor(address token0_, address token1_, uint24 fee_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
    }

    function initialize(uint160 sqrtPriceX96_) external {
        require(sqrtPriceX96 == 0, "INITIALIZED");
        sqrtPriceX96 = sqrtPriceX96_;
    }
}

contract MockV3Factory {
    mapping(bytes32 => address) private _pool;
    mapping(uint24 => int24) public feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[500] = 10;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return _pool[_key(tokenA, tokenB, fee)];
    }

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (address pool)
    {
        bytes32 key = _key(tokenA, tokenB, fee);
        require(_pool[key] == address(0), "EXISTS");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = address(new MockV3Pool(token0, token1, fee));
        _pool[key] = pool;
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockV3PositionManager is INonfungiblePositionManagerMarket {
    MockV3Factory public immutable factory;

    constructor(MockV3Factory factory_) {
        factory = factory_;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool) {
        pool = factory.getPool(token0, token1, fee);
        if (pool == address(0)) pool = factory.createPool(token0, token1, fee);
        if (MockV3Pool(pool).sqrtPriceX96() == 0) {
            MockV3Pool(pool).initialize(sqrtPriceX96);
        }
    }
}

contract OTFV3MarketRegistryTest is ProtocolTestBase {
    MockStockToken private usdg;
    MockV3Factory private v3Factory;
    MockV3PositionManager private positionManager;
    OTFV3MarketRegistry private registry;
    ManagedOTFVault private vault;

    function setUp() public override {
        super.setUp();
        usdg = new MockStockToken("Global Dollar", "USDG", 6);
        v3Factory = new MockV3Factory();
        positionManager = new MockV3PositionManager(v3Factory);
        registry = new OTFV3MarketRegistry(
            address(factory), address(usdg), address(v3Factory), address(positionManager)
        );
        factory.setOfficialMarketRegistry(address(registry));
        vault = _createVault();
    }

    function testVaultCreationCreatesImmutableOfficialFiveBpsPool() public view {
        address pool = registry.officialPool(address(vault));

        assertTrue(pool != address(0));
        assertEq(v3Factory.getPool(address(vault), address(usdg), 500), pool);
        assertEq(uint256(MockV3Pool(pool).fee()), 500);
        assertGt(uint256(MockV3Pool(pool).sqrtPriceX96()), 0);
        assertEq(uint256(MockV3Pool(pool).liquidity()), 0);
    }

    function testRegistryAssociationLocksAfterFirstVault() public {
        vm.expectPartialRevert(OTFV3MarketRegistry.OfficialPoolAlreadySet.selector);
        vm.prank(address(factory));
        registry.createOfficialPool(address(vault));

        MockOfficialMarketRegistry replacementRegistry = new MockOfficialMarketRegistry();
        vm.expectPartialRevert(OTFFactory.OfficialMarketRegistryLocked.selector);
        factory.setOfficialMarketRegistry(address(replacementRegistry));
    }

    function testOnlyFactoryCanCreateOfficialPool() public {
        vm.expectPartialRevert(OTFV3MarketRegistry.NotOTFFactory.selector);
        registry.createOfficialPool(address(vault));
    }

    function testPrecreatedCanonicalPoolRevertsVaultCreationAtomically() public {
        VaultInitParams memory params = _defaultParams();
        uint256 nonce = factory.creatorNonce(address(this));
        address predicted = factory.predictVaultAddress(address(this), nonce, params);
        address existing = v3Factory.createPool(predicted, address(usdg), 500);
        MockV3Pool(existing).initialize(1234);
        uint256 vaultCountBefore = factory.vaultCount();
        uint256 tokenABalanceBefore = tokenA.balanceOf(address(this));
        uint256 tokenBBalanceBefore = tokenB.balanceOf(address(this));

        vm.expectPartialRevert(OTFV3MarketRegistry.CanonicalPoolAlreadyExists.selector);
        factory.createVault(params);

        assertEq(factory.creatorNonce(address(this)), nonce);
        assertEq(factory.vaultCount(), vaultCountBefore);
        assertEq(predicted.code.length, 0);
        assertEq(tokenA.balanceOf(address(this)), tokenABalanceBefore);
        assertEq(tokenB.balanceOf(address(this)), tokenBBalanceBefore);
        assertEq(uint256(MockV3Pool(existing).sqrtPriceX96()), 1234);

        params.deploymentSalt = keccak256("available-canonical-pool");
        address nextPredicted = factory.predictVaultAddress(address(this), nonce, params);
        ManagedOTFVault second = ManagedOTFVault(factory.createVault(params));

        assertEq(address(second), nextPredicted);
        assertTrue(nextPredicted != predicted);
        assertTrue(registry.officialPool(nextPredicted) != address(0));
    }
}
