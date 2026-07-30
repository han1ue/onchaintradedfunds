// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetRegistry } from "../src/AssetRegistry.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OracleRegistry } from "../src/OracleRegistry.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { TradeInstruction, VaultInitParams } from "../src/VaultTypes.sol";
import { TestBase } from "./TestBase.sol";

abstract contract ProtocolTestBase is TestBase {
    uint256 internal constant START = 1_700_000_000;
    uint256 internal constant ONE = 1e18;
    address internal constant TREASURY = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant ATTACKER = address(0xBAD);

    MockStockToken internal tokenA;
    MockStockToken internal tokenB;
    MockStockToken internal tokenC;
    MockPriceFeed internal feedA;
    MockPriceFeed internal feedB;
    MockPriceFeed internal feedC;
    AssetRegistry internal assetRegistry;
    OracleRegistry internal oracleRegistry;
    RebalanceExecutor internal executor;
    MockTradeAdapter internal adapter;
    FeeCollector internal collector;
    OTFFactory internal factory;

    function setUp() public virtual {
        _deployProtocol();
    }

    function _deployProtocol() internal {
        vm.warp(START);

        tokenA = new MockStockToken("Stock A", "A", 18);
        tokenB = new MockStockToken("Stock B", "B", 18);
        tokenC = new MockStockToken("Stock C", "C", 18);
        feedA = new MockPriceFeed(8, 100_00000000);
        feedB = new MockPriceFeed(8, 100_00000000);
        feedC = new MockPriceFeed(8, 100_00000000);

        assetRegistry = new AssetRegistry(address(this));
        oracleRegistry = new OracleRegistry(address(this));
        executor = new RebalanceExecutor(address(this));
        adapter = new MockTradeAdapter();
        collector = new FeeCollector(TREASURY);

        assetRegistry.setAssetApproved(address(tokenA), true);
        assetRegistry.setAssetApproved(address(tokenB), true);
        assetRegistry.setAssetApproved(address(tokenC), true);
        oracleRegistry.setPriceFeed(address(tokenA), address(feedA));
        oracleRegistry.setPriceFeed(address(tokenB), address(feedB));
        oracleRegistry.setPriceFeed(address(tokenC), address(feedC));

        ManagedOTFVault implementation = new ManagedOTFVault();
        factory = new OTFFactory(
            address(implementation),
            TREASURY,
            address(collector),
            address(assetRegistry),
            address(oracleRegistry),
            address(executor),
            1_500
        );
        executor.setFactory(address(factory));
        factory.setTradeAdapterApproved(address(adapter), true);

        tokenA.mint(address(this), 1_000_000 * ONE);
        tokenB.mint(address(this), 1_000_000 * ONE);
        tokenC.mint(address(this), 1_000_000 * ONE);
        tokenA.mint(address(adapter), 1_000_000 * ONE);
        tokenB.mint(address(adapter), 1_000_000 * ONE);
        tokenC.mint(address(adapter), 1_000_000 * ONE);
        adapter.setRate(address(tokenA), address(tokenB), 1, 1);
        adapter.setRate(address(tokenB), address(tokenA), 1, 1);
        adapter.setRate(address(tokenA), address(tokenC), 1, 1);
        adapter.setRate(address(tokenC), address(tokenA), 1, 1);
        adapter.setRate(address(tokenB), address(tokenC), 1, 1);
        adapter.setRate(address(tokenC), address(tokenB), 1, 1);

        tokenA.approve(address(factory), type(uint256).max);
        tokenB.approve(address(factory), type(uint256).max);
        tokenC.approve(address(factory), type(uint256).max);
    }

    function _createVault() internal returns (ManagedOTFVault vault) {
        vault = ManagedOTFVault(factory.createVault(_defaultParams()));
    }

    function _defaultParams() internal view returns (VaultInitParams memory params) {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);

        uint16[] memory weights = new uint16[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 * ONE;
        amounts[1] = 500 * ONE;

        params = VaultInitParams({
            name: "Test OTF",
            symbol: "OTF-TEST",
            initialThesis: "A test portfolio with explicit safety limits.",
            manager: address(this),
            feeRecipient: FEE_RECIPIENT,
            initialAssets: assets,
            initialTargetWeightsBps: weights,
            initialAmounts: amounts,
            initialShareSupply: 100 * ONE,
            creatorFeeBpsPerYear: 100,
            rebalanceCooldown: uint32(7 days),
            maxTurnoverBps: 5_000,
            maxNavLossBps: 100,
            maxWeightDeviationBps: 25,
            challengeWeightDeviationBps: 250,
            maxSingleAssetWeightBps: 8_000,
            minNonZeroAssetWeightBps: 100,
            maxAssetCount: 10,
            maxOracleStaleness: uint32(30 days),
            challengeGracePeriod: uint32(3 days)
        });
    }

    function _equalPortfolio()
        internal
        view
        returns (address[] memory assets, uint16[] memory weights)
    {
        assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        weights = new uint16[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;
    }

    function _sixtyFortyPortfolio()
        internal
        view
        returns (address[] memory assets, uint16[] memory weights)
    {
        assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        weights = new uint16[](2);
        weights[0] = 6_000;
        weights[1] = 4_000;
    }

    function _singleTrade(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        internal
        view
        returns (TradeInstruction[] memory trades)
    {
        trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            adapterData: ""
        });
    }

    function _uint256Weights(uint16[] memory weights)
        internal
        pure
        returns (uint256[] memory converted)
    {
        converted = new uint256[](weights.length);
        for (uint256 i = 0; i < weights.length; i++) {
            converted[i] = weights[i];
        }
    }

    function _proposeTarget(ManagedOTFVault vault, address[] memory assets, uint16[] memory weights)
        internal
    {
        vault.rebalance(assets, _uint256Weights(weights));
    }

    function _executeAndComplete(ManagedOTFVault vault, TradeInstruction[] memory trades) internal {
        vault.executeRebalanceTrades(trades);
        vault.completeStrategicRebalance();
    }

    function _rebalanceToTarget(
        ManagedOTFVault vault,
        address[] memory assets,
        uint16[] memory weights,
        TradeInstruction[] memory trades
    ) internal {
        _proposeTarget(vault, assets, weights);
        _executeAndComplete(vault, trades);
    }
}
