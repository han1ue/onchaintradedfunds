// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetRegistry } from "../src/AssetRegistry.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStrategy } from "../src/ManagedOTFVaultStrategy.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OracleRegistry } from "../src/OracleRegistry.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockOfficialMarketRegistry } from "../src/mocks/MockOfficialMarketRegistry.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { TradeInstruction, VaultInitParams } from "../src/VaultTypes.sol";
import { TestBase } from "./TestBase.sol";

contract RebalanceCooldownTest is TestBase {
    uint256 private constant START = 1_700_000_000;
    uint256 private constant ONE = 1e18;
    address private constant NON_MANAGER = address(0xA11CE);

    MockStockToken private tokenA;
    MockStockToken private tokenB;
    AssetRegistry private assetRegistry;
    OracleRegistry private oracleRegistry;
    RebalanceExecutor private executor;
    MockTradeAdapter private adapter;
    MockPriceFeed private feedA;
    MockPriceFeed private feedB;
    OTFFactory private factory;

    function setUp() public {
        vm.warp(START);

        tokenA = new MockStockToken("Mock NVDA", "mNVDA", 18);
        tokenB = new MockStockToken("Mock MSFT", "mMSFT", 18);
        assetRegistry = new AssetRegistry(address(this));
        oracleRegistry = new OracleRegistry(address(this));
        executor = new RebalanceExecutor(address(this));
        adapter = new MockTradeAdapter();

        assetRegistry.setAssetApproved(address(tokenA), true);
        assetRegistry.setAssetApproved(address(tokenB), true);
        feedA = new MockPriceFeed(8, 100_00000000);
        feedB = new MockPriceFeed(8, 100_00000000);
        oracleRegistry.setPriceFeed(address(tokenA), address(feedA));
        oracleRegistry.setPriceFeed(address(tokenB), address(feedB));

        tokenA.mint(address(this), 10_000 * ONE);
        tokenB.mint(address(this), 10_000 * ONE);
        tokenA.mint(address(adapter), 10_000 * ONE);
        tokenB.mint(address(adapter), 10_000 * ONE);
        adapter.setRate(address(tokenA), address(tokenB), 1, 1);
        adapter.setRate(address(tokenB), address(tokenA), 1, 1);

        PortfolioCalculator calculator = new PortfolioCalculator();
        ManagedOTFVaultStrategy strategy = new ManagedOTFVaultStrategy(calculator);
        ManagedOTFVault implementation = new ManagedOTFVault(calculator, address(strategy));
        FeeCollector collector = new FeeCollector(address(0xCAFE));
        factory = new OTFFactory(
            address(implementation),
            address(collector),
            address(assetRegistry),
            address(oracleRegistry),
            address(executor),
            1_500
        );
        executor.setFactory(address(factory));
        factory.setTradeAdapterApproved(address(adapter), true);
        factory.setOfficialMarketRegistry(address(new MockOfficialMarketRegistry()));

        tokenA.approve(address(factory), type(uint256).max);
        tokenB.approve(address(factory), type(uint256).max);
    }

    function testFirstRebalanceBeforeFourteenDaysReverts() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days - 1);
        _refreshPrices();
        vm.expectPartialRevert(ManagedOTFVaultStorage.RebalanceCooldownActive.selector);
        _propose6040(vault);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START));
    }

    function testStrategyChangeUsesOnlyCompletionBasedClock() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 7 days);
        _refreshPrices();
        assertEq(vault.nextRebalanceTime(), START + 14 days);
        assertEq(vault.nextStrategyChangeTime(), vault.nextRebalanceTime());
        assertFalse(vault.canProposeTargetWeights());
        vm.expectPartialRevert(ManagedOTFVaultStorage.RebalanceCooldownActive.selector);
        _propose6040(vault);
    }

    function testFirstStrategyChangeActivatesAfterFourteenDaysPlusNotice() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
        assertEq(vault.nextRebalanceTime(), START + 30 days);
    }

    function testTargetProposalDoesNotResetCooldownUntilCompletion() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _refreshPrices();
        _propose6040(vault);

        assertTrue(vault.strategyProposalPending());
        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.lastRebalanceTimestamp(), uint64(START));
        assertEq(vault.nextRebalanceTime(), START + 14 days);
    }

    function testPendingStrategyCannotActivateBeforeFortyEightHoursAndUsersCanExit() public {
        ManagedOTFVault vault = _createVault(14 days, 0);
        vm.warp(START + 14 days);
        _refreshPrices();
        _propose6040(vault);

        assertEq(vault.pendingStrategyActivationTime(), uint64(START + 16 days));
        assertEq(vault.targetWeightBps(address(tokenA)), 5_000);
        vm.warp(START + 16 days - 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StrategyActivationPending.selector);
        vault.activatePendingStrategy();

        uint256 shares = ONE;
        uint256[] memory minimums = vault.previewRedeem(shares);
        vault.redeem(shares, address(this), address(this), minimums);
        assertTrue(vault.strategyProposalPending());

        vm.warp(START + 16 days);
        _refreshPrices();
        vm.prank(NON_MANAGER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.activatePendingStrategy();
        assertTrue(vault.strategyProposalPending());

        vault.activatePendingStrategy();
        assertFalse(vault.strategyProposalPending());
        assertTrue(vault.strategicRebalanceActive());
        assertEq(vault.targetWeightBps(address(tokenA)), 6_000);
    }

    function testSecondRebalanceBeforeFourteenDaysFromCompletionReverts() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);

        vm.warp(START + 30 days - 1);
        _refreshPrices();
        assertTrue(vault.isWithinTargetBands());
        assertFalse(vault.canProposeTargetWeights());
        vm.expectPartialRevert(ManagedOTFVaultStorage.RebalanceCooldownActive.selector);
        _propose5050(vault);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
    }

    function testSecondStrategyChangeExactlyFourteenDaysAfterCompletionSucceeds() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);

        vm.warp(START + 30 days);
        feedA.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        feedB.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        _rebalanceTo5050(vault, 100 * ONE);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 32 days));
    }

    function testRevertedTargetProposalDoesNotResetCooldown() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _refreshPrices();
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory invalidWeights = new uint256[](2);
        invalidWeights[0] = 9_000;
        invalidWeights[1] = 1_000;
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooHigh.selector);
        vault.rebalance(assets, invalidWeights);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START));

        _rebalanceTo6040(vault, 100 * ONE);
        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
    }

    function testThesisAmendmentDoesNotResetCooldown() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 1 days);
        vault.appendThesisAmendment("Updated thesis, same portfolio.");

        assertEq(vault.lastRebalanceTimestamp(), uint64(START));
        assertEq(vault.thesisVersionCount(), 2);

        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);
        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
    }

    function testWeightBandChangeDoesNotResetPortfolioCooldown() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _refreshPrices();
        vault.setWeightBands(50, 300);

        assertEq(vault.lastRebalanceTimestamp(), uint64(START));
        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);
        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
    }

    function testWeightBandChangeCannotExceedCompletionDeviationCap() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        vm.warp(START + 14 days);
        _refreshPrices();
        uint16 invalidCompletionDeviation = vault.MAX_COMPLETION_DEVIATION_BPS() + 1;
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidWeightBands.selector);
        vault.setWeightBands(invalidCompletionDeviation, 2_500);
    }

    function testFeeAccrualDoesNotResetCooldown() public {
        ManagedOTFVault vault = _createVault(14 days, 100);
        uint256 supplyBefore = vault.totalSupply();

        vm.warp(START + 1 days);
        _refreshPrices();
        vault.accrueFees();

        assertEq(vault.lastRebalanceTimestamp(), uint64(START));
        assertGt(vault.totalSupply(), supplyBefore);

        vm.warp(START + 14 days);
        _rebalanceTo6040(vault, 100 * ONE);
        assertEq(vault.lastRebalanceTimestamp(), uint64(START + 16 days));
    }

    function testManagerCannotShortenCooldown() public {
        ManagedOTFVault vault = _createVault(14 days, 0);

        (bool ok,) = address(vault)
            .call(abi.encodeWithSignature("setRebalanceCooldown(uint32)", uint32(1 days)));

        assertFalse(ok);
        assertEq(vault.rebalanceCooldown(), uint32(14 days));
        assertEq(vault.nextRebalanceTime(), START + 14 days);
    }

    function testFactoryRejectsLongerCooldown() public {
        VaultInitParams memory params = _params(uint32(14 days + 1), 0);

        vm.expectPartialRevert(OTFFactory.InvalidRebalanceCooldown.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsCooldownShorterThanFourteenDays() public {
        VaultInitParams memory params = _params(uint32(14 days - 1), 0);

        vm.expectPartialRevert(OTFFactory.InvalidRebalanceCooldown.selector);
        factory.createVault(params);
    }

    function _createVault(uint32 cooldown, uint16 feeBps) internal returns (ManagedOTFVault) {
        return ManagedOTFVault(factory.createVault(_params(cooldown, feeBps)));
    }

    function _params(uint32 cooldown, uint16 feeBps)
        internal
        view
        returns (VaultInitParams memory params)
    {
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
            name: "Onchain Technology Leaders",
            symbol: "OTF-TECH",
            initialThesis: "A transparent basket of approved mock stock tokens.",
            manager: address(this),
            feeRecipient: address(0xFEE),
            initialAssets: assets,
            initialTargetWeightsBps: weights,
            initialAmounts: amounts,
            initialShareSupply: 100 * ONE,
            creatorFeeBpsPerYear: feeBps,
            rebalanceCooldown: cooldown,
            maxTurnoverBps: 5_000,
            maxNavLossBps: 100,
            maxWeightDeviationBps: 25,
            challengeWeightDeviationBps: 250,
            maxSingleAssetWeightBps: 8_000,
            minNonZeroAssetWeightBps: 100,
            maxAssetCount: 10,
            maxOracleStaleness: 1 hours,
            challengeGracePeriod: 5 days
        });
    }

    function _rebalanceTo6040(ManagedOTFVault vault, uint256 tokenBAmountIn) internal {
        _refreshPrices();
        _propose6040(vault);
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenB),
            tokenOut: address(tokenA),
            amountIn: tokenBAmountIn,
            minAmountOut: tokenBAmountIn,
            adapterData: ""
        });
        vault.executeRebalanceTrades(trades);
    }

    function _propose6040(ManagedOTFVault vault) internal {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);

        uint256[] memory weights = new uint256[](2);
        weights[0] = 6_000;
        weights[1] = 4_000;

        vault.rebalance(assets, weights);
    }

    function _rebalanceTo5050(ManagedOTFVault vault, uint256 tokenAAmountIn) internal {
        _refreshPrices();
        _propose5050(vault);
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: tokenAAmountIn,
            minAmountOut: tokenAAmountIn,
            adapterData: ""
        });
        vault.executeRebalanceTrades(trades);
    }

    function _propose5050(ManagedOTFVault vault) internal {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;

        vault.rebalance(assets, weights);
    }

    function _refreshPrices() internal {
        uint80 nextRoundA = feedA.roundId() + 1;
        uint80 nextRoundB = feedB.roundId() + 1;
        feedA.setRoundData(nextRoundA, feedA.answer(), block.timestamp, block.timestamp, nextRoundA);
        feedB.setRoundData(nextRoundB, feedB.answer(), block.timestamp, block.timestamp, nextRoundB);
    }
}
