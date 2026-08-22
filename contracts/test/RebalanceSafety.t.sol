// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../src/ERC20Base.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import {
    AssetPricingConfig,
    PricingSource,
    RebalanceRecord,
    TradeExecutionRecord,
    TradeInstruction,
    VaultInitParams
} from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract RebalanceSafetyTest is ProtocolTestBase {
    function testTrackedAssetLimitIncludesRetiringUnion() public {
        ManagedOTFVault acceptedVault = _createVault();
        ManagedOTFVault rejectedVault = _createVault();
        vm.warp(START + 14 days);
        _refreshPrices();

        address[] memory additions = new address[](99);
        AssetPricingConfig[] memory additionConfigs = new AssetPricingConfig[](99);
        for (uint256 i = 0; i < additions.length; i++) {
            MockStockToken asset = new MockStockToken("Additional Stock", "ADD", 18);
            MockPriceFeed feed = new MockPriceFeed(8, 100_00000000);
            additions[i] = address(asset);
            assetRegistry.registerAsset(address(asset));
            additionConfigs[i] = _directPricing(address(feed));
        }

        address[] memory acceptedTargets = new address[](99);
        uint256[] memory acceptedWeights = new uint256[](99);
        AssetPricingConfig[] memory acceptedConfigs = new AssetPricingConfig[](99);
        acceptedTargets[0] = address(tokenA);
        acceptedWeights[0] = 200;
        acceptedConfigs[0] = _directPricing(address(feedA));
        for (uint256 i = 1; i < acceptedTargets.length; i++) {
            acceptedTargets[i] = additions[i - 1];
            acceptedWeights[i] = 100;
            acceptedConfigs[i] = additionConfigs[i - 1];
        }
        acceptedVault.proposeStrategyWithPricing(
            acceptedTargets,
            acceptedWeights,
            acceptedConfigs,
            "Exercise the 100 tracked-asset boundary."
        );
        assertTrue(acceptedVault.strategyProposalPending());

        address[] memory rejectedTargets = new address[](100);
        uint256[] memory rejectedWeights = new uint256[](100);
        AssetPricingConfig[] memory rejectedConfigs = new AssetPricingConfig[](100);
        rejectedTargets[0] = address(tokenA);
        rejectedWeights[0] = 100;
        rejectedConfigs[0] = _directPricing(address(feedA));
        for (uint256 i = 1; i < rejectedTargets.length; i++) {
            rejectedTargets[i] = additions[i - 1];
            rejectedWeights[i] = 100;
            rejectedConfigs[i] = additionConfigs[i - 1];
        }
        vm.expectRevert(ManagedOTFVaultStorage.TrackedAssetLimitExceeded.selector);
        rejectedVault.proposeStrategyWithPricing(
            rejectedTargets, rejectedWeights, rejectedConfigs, "Reject a 101-asset tracked union."
        );
    }

    function testOnlyManagerCanChangeStrategy() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);

        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.proposeStrategy(assets, _uint256Weights(weights), "Authorized target update.");
    }

    function testTargetProposalDoesNotExecuteOrCompleteTrades() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);

        _proposeTarget(vault, assets, weights);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertTrue(vault.strategicRebalanceActive());
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));
        assertEq(vault.rebalanceCount(), 0);
        vm.expectRevert(ManagedOTFVaultStorage.TargetBandsNotReached.selector);
        vault.completeStrategicRebalance();
    }

    function testSuccessfulPartialExecutionRecordsCompletionAndClearsApprovals() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        TradeInstruction[] memory first =
            _singleTrade(address(tokenB), address(tokenA), 50 * ONE, 50 * ONE);
        TradeInstruction[] memory second =
            _singleTrade(address(tokenB), address(tokenA), 50 * ONE, 50 * ONE);
        vm.warp(START + 14 days);

        _proposeTarget(vault, assets, weights);
        vault.executeRebalanceTrades(first);
        assertTrue(vault.strategicRebalanceActive());
        vault.executeRebalanceTrades(second);

        assertEq(tokenA.balanceOf(address(vault)), 600 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 400 * ONE);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
        assertEq(tokenA.balanceOf(address(executor)), 0);
        assertEq(tokenB.balanceOf(address(executor)), 0);
        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.rebalanceCount(), 1);
        assertEq(vault.lastCompletedStrategyTimestamp(), START + 16 days);

        RebalanceRecord memory record = vault.recentRebalanceRecord(0);
        assertEq(record.manager, address(this));
        assertEq(record.navPerShareBefore, record.navPerShareAfter);
        assertLt(record.navPerShareBefore, 1_000 * ONE);
        assertEq(record.turnoverBps, 1_000);
        assertEq(record.executionLossBps, 0);
    }

    function testAdapterFailureRevertsTradeButLeavesTargetActive() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE);
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);
        adapter.setFailNextSwap(true);

        vm.expectRevert(MockTradeAdapter.MockSwapFailed.selector);
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
        assertTrue(vault.strategicRebalanceActive());
    }

    function testOracleValuedSlippageRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        adapter.setRate(address(tokenB), address(tokenA), 8, 10);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 80 * ONE);
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);

        vm.expectPartialRevert(ManagedOTFVaultStorage.OracleSlippageTooHigh.selector);
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
    }

    function testNavLossBudgetReplenishesLinearlyAndGainsDoNotRefundIt() public {
        VaultInitParams memory params = _defaultParams();
        params.maxNavLossBps = 2;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);

        uint256 amountIn = 20 * ONE;
        adapter.setRate(address(tokenB), address(tokenA), 9_998, 10_000);
        TradeInstruction[] memory lossy =
            _singleTrade(address(tokenB), address(tokenA), amountIn, amountIn * 9_998 / 10_000);
        vault.executeRebalanceTrades(lossy);

        (uint64 recoveryAt, uint16 usedLossBps, uint16 maximumLossBps) = vault.navLossBudgetState();
        assertEq(usedLossBps, 1);
        assertEq(maximumLossBps, 2);
        assertGt(recoveryAt, block.timestamp);

        adapter.setRate(address(tokenB), address(tokenA), 10_001, 10_000);
        TradeInstruction[] memory profitable =
            _singleTrade(address(tokenB), address(tokenA), amountIn, amountIn);
        vault.executeRebalanceTrades(profitable);
        (, usedLossBps,) = vault.navLossBudgetState();
        assertEq(usedLossBps, 1);

        adapter.setRate(address(tokenB), address(tokenA), 9_998, 10_000);
        vault.executeRebalanceTrades(lossy);
        (, usedLossBps,) = vault.navLossBudgetState();
        assertEq(usedLossBps, 2);

        uint256 tokenBBefore = tokenB.balanceOf(address(vault));
        vm.expectPartialRevert(ManagedOTFVaultStorage.NavLossBudgetExceeded.selector);
        vault.executeRebalanceTrades(lossy);
        assertEq(tokenB.balanceOf(address(vault)), tokenBBefore);

        vm.warp(block.timestamp + vault.NAV_LOSS_RECOVERY_PERIOD() / 2);
        _refreshPrices();
        (, usedLossBps,) = vault.navLossBudgetState();
        assertEq(usedLossBps, 1);

        vault.executeRebalanceTrades(lossy);
        (, uint16 replenishedUsedLossBps,) = vault.navLossBudgetState();
        assertEq(replenishedUsedLossBps, 2);

        vm.expectPartialRevert(ManagedOTFVaultStorage.NavLossBudgetExceeded.selector);
        vault.executeRebalanceTrades(lossy);

        assertEq(vault.recentTradeExecutionCount(), 4);
        TradeExecutionRecord memory record = vault.recentTradeExecutionRecord(3);
        assertEq(record.batchLossBps, 1);
        assertEq(record.navLossBudgetUsedBps, 2);
        assertEq(record.tradeCount, 1);
    }

    function testNavLossBudgetFullyReplenishesAtRecoveryTimestamp() public {
        VaultInitParams memory params = _defaultParams();
        params.maxNavLossBps = 2;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);

        uint256 amountIn = 20 * ONE;
        adapter.setRate(address(tokenB), address(tokenA), 9_998, 10_000);
        TradeInstruction[] memory lossy =
            _singleTrade(address(tokenB), address(tokenA), amountIn, amountIn * 9_998 / 10_000);
        vault.executeRebalanceTrades(lossy);
        vault.executeRebalanceTrades(lossy);

        (uint64 recoveryAt, uint16 usedLossBps,) = vault.navLossBudgetState();
        assertEq(usedLossBps, 2);

        vm.warp(recoveryAt - 1);
        _refreshPrices();
        (uint64 remainingRecoveryAt, uint16 remainingUsedLossBps,) = vault.navLossBudgetState();
        assertEq(remainingRecoveryAt, recoveryAt);
        assertEq(remainingUsedLossBps, 1);

        vm.warp(recoveryAt);
        _refreshPrices();
        (uint64 emptyRecoveryAt, uint16 emptyUsedLossBps,) = vault.navLossBudgetState();
        assertEq(emptyRecoveryAt, recoveryAt);
        assertEq(emptyUsedLossBps, 0);

        vault.executeRebalanceTrades(lossy);
        (, usedLossBps,) = vault.navLossBudgetState();
        assertEq(usedLossBps, 1);
    }

    function testTradeMustMoveEveryExposureTowardTarget() public {
        ManagedOTFVault vault = _createVault();
        TradeInstruction[] memory wrongDirection =
            _singleTrade(address(tokenA), address(tokenB), 10 * ONE, 10 * ONE);

        vm.expectPartialRevert(ManagedOTFVaultStorage.TradeDoesNotImproveTarget.selector);
        vault.executeRebalanceTrades(wrongDirection);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testStrategyTurnoverDoesNotBlockTargetProposal() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategy(assets, _uint256Weights(weights), "Target update under test.");
        assertTrue(vault.strategyProposalPending());
        assertEq(vault.lastCompletedStrategyTimestamp(), START);
    }

    function testUnapprovedAdapterAndUnsupportedTokensAreRejected() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);
        TradeInstruction[] memory trades = _singleTrade(address(tokenA), address(tokenB), ONE, ONE);

        factory.setTradeAdapterApproved(address(adapter), false);
        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnapprovedAdapter.selector);
        vault.executeRebalanceTrades(trades);

        factory.setTradeAdapterApproved(address(adapter), true);
        trades = _singleTrade(address(tokenA), address(tokenC), ONE, ONE);
        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.TradeAssetNotTracked.selector);
        vault.executeRebalanceTrades(trades);
    }

    function testPortfolioShapeProtectionsUseERC7621Errors() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 14 days);
        _refreshPrices();

        address[] memory emptyAssets = new address[](0);
        uint256[] memory emptyWeights = new uint256[](0);
        vm.expectRevert(ManagedOTFVaultStorage.EmptyPortfolio.selector);
        vault.proposeStrategy(emptyAssets, emptyWeights, "Invalid empty target update.");

        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory weights = new uint256[](2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooLow.selector);
        vault.proposeStrategy(assets, weights, "Invalid target update under test.");

        assets[1] = address(tokenA);
        weights[0] = 5_000;
        weights[1] = 5_000;
        vm.expectPartialRevert(IERC7621.DuplicateConstituent.selector);
        vault.proposeStrategy(assets, weights, "Invalid target update under test.");

        assets[1] = address(tokenB);
        weights[0] = 5_001;
        vm.expectPartialRevert(IERC7621.InvalidWeights.selector);
        vault.proposeStrategy(assets, weights, "Invalid target update under test.");

        weights[0] = 9_950;
        weights[1] = 50;
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooLow.selector);
        vault.proposeStrategy(assets, weights, "Target below the protocol minimum.");
    }

    function testManagerRemovedConstituentPausesDepositsAndIsPrunedAtZero() public {
        factory.setMinTargetWeightBps(10);
        ManagedOTFVault vault = _createVault();
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10_000;
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategy(assets, weights, "Concentrate the portfolio in Stock A.");
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        assertTrue(vault.isConstituent(address(tokenB)));
        assertEq(vault.targetWeightBps(address(tokenB)), 0);
        assertEq(vault.assetCount(), 2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.DepositsPausedForRetiringAsset.selector);
        vault.previewMint(ONE);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 500 * ONE, 500 * ONE);
        vault.executeRebalanceTrades(trades);

        assertFalse(vault.strategicRebalanceActive());
        assertFalse(vault.isConstituent(address(tokenB)));
        assertEq(vault.assetCount(), 1);
        assertEq(vault.currentWeight(address(tokenA)), 10_000);
        assertEq(vault.previewMint(ONE).length, 1);
    }

    function testFullBalanceRetirementTradeIncludesDonationAndPrunesAtomically() public {
        ManagedOTFVault vault = _createVault();
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        _proposeTarget(vault, assets, weights);

        uint256 quotedBalance = tokenB.balanceOf(address(vault));
        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), type(uint256).max, quotedBalance);
        uint256 donation = vault.MAX_RETIRING_DUST() + 1;
        tokenB.mint(ATTACKER, donation);
        vm.prank(ATTACKER);
        assertTrue(tokenB.transfer(address(vault), donation));

        uint256 tokenABefore = tokenA.balanceOf(address(vault));
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), tokenABefore + quotedBalance + donation);
        assertEq(tokenB.balanceOf(address(vault)), 0);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
        assertEq(vault.assetCount(), 1);
        assertFalse(vault.isConstituent(address(tokenB)));
        assertFalse(vault.strategicRebalanceActive());
    }

    function testFullBalanceSentinelRejectsActiveOrEmptyRetiringAsset() public {
        ManagedOTFVault vault = _createVault();
        TradeInstruction[] memory activeTrade =
            _singleTrade(address(tokenA), address(tokenB), type(uint256).max, 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BadTrade.selector);
        vault.executeRebalanceTrades(activeTrade);

        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        _proposeTarget(vault, assets, weights);
        uint256 retiringBalance = tokenB.balanceOf(address(vault));
        vm.prank(address(vault));
        assertTrue(tokenB.transfer(ALICE, retiringBalance));

        TradeInstruction[] memory emptyRetiringTrade =
            _singleTrade(address(tokenB), address(tokenA), type(uint256).max, 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BadTrade.selector);
        vault.executeRebalanceTrades(emptyRetiringTrade);
    }

    function testFullBalanceSentinelUsesDonatedAmountForOracleSlippage() public {
        ManagedOTFVault vault = _createVault();
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        _proposeTarget(vault, assets, weights);

        uint256 donation = 100 * ONE;
        tokenB.mint(ATTACKER, donation);
        vm.prank(ATTACKER);
        assertTrue(tokenB.transfer(address(vault), donation));
        adapter.setRate(address(tokenB), address(tokenA), 98, 100);
        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), type(uint256).max, 1);
        uint256 retiringBalance = tokenB.balanceOf(address(vault));

        vm.expectPartialRevert(ManagedOTFVaultStorage.OracleSlippageTooHigh.selector);
        vault.executeRebalanceTrades(trades);
        assertEq(tokenB.balanceOf(address(vault)), retiringBalance);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
    }

    function testManagerCanReplaceConstituentInSingleStrategyUpdate() public {
        ManagedOTFVault vault = _createVault();
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenC);
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategyWithPricing(
            assets,
            weights,
            _pricingConfigsFor(assets),
            "Replace Stock B with Stock C while preserving equal target weights."
        );

        assertTrue(vault.strategyProposalPending());
        assertTrue(vault.isConstituent(address(tokenB)));
        assertFalse(vault.isConstituent(address(tokenC)));

        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        assertTrue(vault.strategicRebalanceActive());
        assertTrue(vault.isConstituent(address(tokenB)));
        assertTrue(vault.isConstituent(address(tokenC)));
        assertEq(vault.targetWeightBps(address(tokenB)), 0);
        assertEq(vault.targetWeightBps(address(tokenC)), 5_000);
        assertEq(vault.assetCount(), 3);
        vm.expectPartialRevert(ManagedOTFVaultStorage.DepositsPausedForRetiringAsset.selector);
        vault.previewMint(ONE);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenC), 500 * ONE, 500 * ONE);
        vault.executeRebalanceTrades(trades);

        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.rebalanceCount(), 1);
        assertFalse(vault.isConstituent(address(tokenB)));
        assertTrue(vault.isConstituent(address(tokenA)));
        assertTrue(vault.isConstituent(address(tokenC)));
        assertEq(vault.assetCount(), 2);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 0);
        assertEq(tokenC.balanceOf(address(vault)), 500 * ONE);
        assertEq(vault.currentWeight(address(tokenA)), 5_000);
        assertEq(vault.currentWeight(address(tokenC)), 5_000);
        assertEq(vault.previewMint(ONE).length, 2);

        (bool oldPricingStillConfigured,,,,,,,) = vault.pricingConfigForAsset(address(tokenB));
        assertFalse(oldPricingStillConfigured);

        MockPriceFeed replacementFeed = new MockPriceFeed(8, 100_00000000);
        vm.warp(vault.nextStrategyChangeTime());
        _refreshPrices();
        _refreshPrice(replacementFeed);

        address[] memory readdedAssets = new address[](2);
        readdedAssets[0] = address(tokenA);
        readdedAssets[1] = address(tokenB);
        uint256[] memory readdedWeights = new uint256[](2);
        readdedWeights[0] = 5_000;
        readdedWeights[1] = 5_000;
        AssetPricingConfig[] memory readdedPricing = new AssetPricingConfig[](2);
        readdedPricing[0] = _directPricing(address(feedA));
        readdedPricing[1] = _directPricing(address(replacementFeed));

        vault.proposeStrategyWithPricing(
            readdedAssets,
            readdedWeights,
            readdedPricing,
            "Reintroduce Stock B with a newly validated pricing source."
        );
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        _refreshPrice(replacementFeed);
        vault.activatePendingStrategy();

        (bool readdedPricingConfigured,,, address readdedPrimarySource,,,,) =
            vault.pricingConfigForAsset(address(tokenB));
        assertTrue(readdedPricingConfigured);
        assertEq(readdedPrimarySource, address(replacementFeed));

        RebalanceRecord memory record = vault.recentRebalanceRecord(0);
        assertEq(record.turnoverBps, 5_000);
    }

    function testNewAssetPricingPinsOnlyWhenProposalActivates() public {
        ManagedOTFVault vault = _createVault();
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenC);
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;
        AssetPricingConfig[] memory pricingConfigs = _pricingConfigsFor(assets);
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategyWithPricing(
            assets, weights, pricingConfigs, "Stage a new asset without pinning before activation."
        );
        (bool configuredBefore,,,,,,,) = vault.pricingConfigForAsset(address(tokenC));
        assertFalse(configuredBefore);

        vault.cancelPendingStrategy();
        (bool configuredAfterCancellation,,,,,,,) = vault.pricingConfigForAsset(address(tokenC));
        assertFalse(configuredAfterCancellation);

        vault.proposeStrategyWithPricing(
            assets, weights, pricingConfigs, "Activate the new asset and pin its pricing identity."
        );
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        (
            bool configured,
            PricingSource source,
            address quoteToken,
            address primarySource,
            address secondarySource,
            address normalizedPriceFeed,
            uint32 primaryMaxStaleness,
            uint32 secondaryMaxStaleness
        ) = vault.pricingConfigForAsset(address(tokenC));
        assertTrue(configured);
        assertEq(uint256(source), uint256(PricingSource.RobinhoodDirect));
        assertEq(quoteToken, address(0));
        assertEq(primarySource, address(feedC));
        assertEq(secondarySource, address(0));
        assertEq(normalizedPriceFeed, address(feedC));
        assertEq(uint256(primaryMaxStaleness), 25 hours);
        assertEq(uint256(secondaryMaxStaleness), 0);
        assertEq(vault.marketIdForAsset(address(tokenC)), bytes32(0));
    }

    function testMalformedAndOversizedTradeBatchesRevert() public {
        ManagedOTFVault vault = _createVault();
        TradeInstruction[] memory trades = _singleTrade(address(tokenA), address(tokenA), ONE, ONE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BadTrade.selector);
        vault.executeRebalanceTrades(trades);

        trades = new TradeInstruction[](21);
        vm.expectPartialRevert(ManagedOTFVaultStorage.TooManyTrades.selector);
        vault.executeRebalanceTrades(trades);
    }

    function testOracleValidityChecksApplyToMonitoringAndTrades() public {
        ManagedOTFVault vault = _createVault();

        feedA.setRoundData(2, 0, block.timestamp, block.timestamp, 2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidOraclePrice.selector);
        vault.isWithinTargetBands();

        feedA.setRoundData(3, 100_00000000, block.timestamp, block.timestamp + 1, 3);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidOracleTimestamp.selector);
        vault.currentWeightsBps();

        feedA.setRoundData(4, 100_00000000, block.timestamp, block.timestamp, 3);
        vm.expectPartialRevert(ManagedOTFVaultStorage.IncompleteOracleRound.selector);
        vault.totalAssetsValue();

        feedA.setRoundData(5, 100_00000000, block.timestamp, block.timestamp, 5);
        vm.warp(START + 30 days + 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StaleOraclePrice.selector);
        vault.totalAssetsValue();
    }

    function testAuthorizedExecutorCanTradeButCannotChangeStrategyOrAdministration() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE);
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);

        vm.prank(ALICE);
        vault.executeRebalanceTrades(trades);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.proposeStrategy(assets, _uint256Weights(weights), "Executor authorization test.");

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setExecutor(BOB, true);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setManagerFeeBps(50);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setWeightBands(100, 300);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setNextStrategyRationale("executor cannot stage strategy rationale");

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.transferOwnership(BOB);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setFeeRecipient(BOB);
    }

    function testManagerCanAuthorizeAndRemoveMultipleExecutors() public {
        ManagedOTFVault vault = _createVault();

        vault.setExecutor(ALICE, true);
        vault.setExecutor(BOB, true);

        assertTrue(vault.authorizedExecutor(ALICE));
        assertTrue(vault.authorizedExecutor(BOB));
        assertTrue(vault.authorizedExecutor(address(this)));
        assertEq(vault.authorizedExecutors().length, 3);

        vault.setExecutor(ALICE, false);

        assertFalse(vault.authorizedExecutor(ALICE));
        assertTrue(vault.authorizedExecutor(BOB));
        address[] memory remaining = vault.authorizedExecutors();
        assertEq(remaining.length, 2);
        assertTrue(remaining[0] == address(this) || remaining[1] == address(this));
        assertTrue(remaining[0] == BOB || remaining[1] == BOB);
    }

    function testExecutorCannotWithdrawAssetsOrSelectARecipient() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);

        vm.prank(ALICE);
        vm.expectPartialRevert(ERC20Base.ERC20InsufficientAllowance.selector);
        tokenA.transferFrom(address(vault), ATTACKER, ONE);

        assertEq(tokenA.allowance(address(vault), ALICE), 0);
        assertEq(tokenA.balanceOf(ATTACKER), 0);

        vm.prank(ALICE);
        (bool arbitraryCallSucceeded,) = address(vault)
            .call(abi.encodeWithSignature("execute(address,bytes)", address(tokenA), bytes("")));
        assertFalse(arbitraryCallSucceeded);
        assertEq(tokenA.balanceOf(ATTACKER), 0);
    }

    function testExecutorCannotBypassSlippageOrTargetImprovementChecks() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _proposeTarget(vault, assets, weights);

        adapter.setRate(address(tokenB), address(tokenA), 8, 10);
        TradeInstruction[] memory badSlippage =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 80 * ONE);
        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.OracleSlippageTooHigh.selector);
        vault.executeRebalanceTrades(badSlippage);

        adapter.setRate(address(tokenB), address(tokenA), 1, 1);
        TradeInstruction[] memory wrongDirection =
            _singleTrade(address(tokenA), address(tokenB), 10 * ONE, 10 * ONE);
        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.TradeDoesNotImproveTarget.selector);
        vault.executeRebalanceTrades(wrongDirection);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenA.allowance(address(vault), address(executor)), 0);
        assertEq(tokenB.allowance(address(vault), address(executor)), 0);
    }

    function testUnauthorizedExecutorCannotTradeAndManagerTransferClearsExecutors() public {
        ManagedOTFVault vault = _createVault();
        TradeInstruction[] memory trades = _singleTrade(address(tokenA), address(tokenB), ONE, ONE);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotTradeAuthority.selector);
        vault.executeRebalanceTrades(trades);

        vault.setExecutor(ALICE, true);
        vault.transferOwnership(BOB);

        assertFalse(vault.authorizedExecutor(ALICE));
        assertFalse(vault.authorizedExecutor(address(this)));
        assertTrue(vault.authorizedExecutor(BOB));
        assertEq(vault.authorizedExecutors().length, 1);
        assertEq(vault.authorizedExecutors()[0], BOB);
        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotTradeAuthority.selector);
        vault.executeRebalanceTrades(trades);
    }

    function testManagerCanRemoveAndRestoreOwnExecutorPermission() public {
        ManagedOTFVault vault = _createVault();
        assertTrue(vault.authorizedExecutor(address(this)));

        vault.setExecutor(address(this), false);
        assertFalse(vault.authorizedExecutor(address(this)));

        TradeInstruction[] memory trades = _singleTrade(address(tokenA), address(tokenB), ONE, ONE);
        vm.expectRevert(ManagedOTFVaultStorage.NotTradeAuthority.selector);
        vault.executeRebalanceTrades(trades);

        vault.setExecutor(address(this), true);
        assertTrue(vault.authorizedExecutor(address(this)));
    }

    function testCoreExecutorRejectsArbitraryCallers() public {
        TradeInstruction memory trade = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: ONE,
            minAmountOut: ONE,
            adapterData: ""
        });
        vm.prank(ATTACKER);
        vm.expectRevert(RebalanceExecutor.UnauthorizedVault.selector);
        executor.executeTrade(trade, trade.amountIn);
    }
}
