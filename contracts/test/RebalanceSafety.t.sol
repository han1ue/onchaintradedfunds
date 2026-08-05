// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../src/ERC20Base.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { RebalanceRecord, TradeInstruction, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract RebalanceSafetyTest is ProtocolTestBase {
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
        assertEq(record.navBefore, 100_000 * ONE);
        assertEq(record.navAfter, 100_000 * ONE);
        assertEq(record.turnoverBps, 1_000);
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

    function testTradeMustMoveEveryExposureTowardTarget() public {
        ManagedOTFVault vault = _createVault();
        TradeInstruction[] memory wrongDirection =
            _singleTrade(address(tokenA), address(tokenB), 10 * ONE, 10 * ONE);

        vm.expectPartialRevert(ManagedOTFVaultStorage.TradeDoesNotImproveTarget.selector);
        vault.executeRebalanceTrades(wrongDirection);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testTurnoverLimitRejectsTargetBeforeTrading() public {
        VaultInitParams memory params = _defaultParams();
        params.maxTurnoverBps = 500;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();

        vm.expectPartialRevert(ManagedOTFVaultStorage.TurnoverTooHigh.selector);
        vault.proposeStrategy(assets, _uint256Weights(weights), "Target update under test.");
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

        weights[0] = 9_900;
        weights[1] = 100;
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooHigh.selector);
        vault.proposeStrategy(assets, weights, "Invalid target update under test.");
    }

    function testManagerRemovedConstituentPausesDepositsAndIsPrunedAtZero() public {
        VaultInitParams memory params = _defaultParams();
        params.maxSingleAssetWeightBps = 10_000;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10_000;
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategy(assets, weights, "Invalid target update under test.");
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        assertTrue(vault.isConstituent(address(tokenB)));
        assertEq(vault.targetWeightBps(address(tokenB)), 0);
        assertEq(vault.assetCount(), 2);
        vm.expectPartialRevert(
            ManagedOTFVaultStorage.DepositsPausedForAssetRemoval.selector
        );
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

    function testRevokedConstituentImmediatelyChallengesAndPrunesWithoutNotice() public {
        ManagedOTFVault vault = _createVault();
        assetRegistry.setAssetApproved(address(tokenA), false);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 50 * ONE;
        amounts[1] = 50 * ONE;
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnapprovedAsset.selector);
        vault.previewContribute(amounts);

        tokenA.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnapprovedAsset.selector);
        vault.contribute(amounts, ALICE, 1);
        vm.stopPrank();

        uint16[] memory effectiveTargets = vault.targetWeightsBps();
        assertEq(effectiveTargets[0], 0);
        assertEq(effectiveTargets[1], 10_000);

        vm.prank(ATTACKER);
        vault.flagOutOfBand();
        assertTrue(vault.challengeActive());

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenA), address(tokenB), 500 * ONE, 500 * ONE);
        vault.executeRebalanceTrades(trades);

        assertFalse(vault.challengeActive());
        assertFalse(vault.isConstituent(address(tokenA)));
        assertEq(tokenA.balanceOf(address(vault)), 0);
        assertEq(vault.assetCount(), 1);
        assertEq(vault.getWeight(address(tokenB)), 10_000);
        assertEq(vault.previewMint(ONE).length, 1);
    }

    function testRevokedWeightIsRedistributedProportionallyAndPersistsAfterPruning() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](3);
        params.initialAssets[0] = address(tokenA);
        params.initialAssets[1] = address(tokenB);
        params.initialAssets[2] = address(tokenC);
        params.initialTargetWeightsBps = new uint16[](3);
        params.initialTargetWeightsBps[0] = 6_000;
        params.initialTargetWeightsBps[1] = 3_000;
        params.initialTargetWeightsBps[2] = 1_000;
        params.initialAmounts = new uint256[](3);
        params.initialAmounts[0] = 600 * ONE;
        params.initialAmounts[1] = 300 * ONE;
        params.initialAmounts[2] = 100 * ONE;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assetRegistry.setAssetApproved(address(tokenC), false);

        uint16[] memory effectiveTargets = vault.targetWeightsBps();
        assertEq(effectiveTargets[0], 6_667);
        assertEq(effectiveTargets[1], 3_333);
        assertEq(effectiveTargets[2], 0);
        assertEq(uint256(effectiveTargets[0]) + effectiveTargets[1] + effectiveTargets[2], 10_000);

        TradeInstruction[] memory trades = new TradeInstruction[](2);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenC),
            tokenOut: address(tokenA),
            amountIn: 67 * ONE,
            minAmountOut: 67 * ONE,
            adapterData: ""
        });
        trades[1] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenC),
            tokenOut: address(tokenB),
            amountIn: 33 * ONE,
            minAmountOut: 33 * ONE,
            adapterData: ""
        });
        vault.executeRebalanceTrades(trades);

        assertFalse(vault.isConstituent(address(tokenC)));
        assertEq(vault.targetWeightBps(address(tokenA)), 6_667);
        assertEq(vault.targetWeightBps(address(tokenB)), 3_333);
        uint16[] memory storedTargets = vault.targetWeightsBps();
        assertEq(uint256(storedTargets[0]) + storedTargets[1], 10_000);
    }

    function testRevocationRoundingAssignsEveryBasisPoint() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](3);
        params.initialAssets[0] = address(tokenA);
        params.initialAssets[1] = address(tokenB);
        params.initialAssets[2] = address(tokenC);
        params.initialTargetWeightsBps = new uint16[](3);
        params.initialTargetWeightsBps[0] = 5_001;
        params.initialTargetWeightsBps[1] = 2_999;
        params.initialTargetWeightsBps[2] = 2_000;
        params.initialAmounts = new uint256[](3);
        params.initialAmounts[0] = 5_001 * ONE;
        params.initialAmounts[1] = 2_999 * ONE;
        params.initialAmounts[2] = 2_000 * ONE;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assetRegistry.setAssetApproved(address(tokenA), false);

        uint16[] memory effectiveTargets = vault.targetWeightsBps();
        assertEq(effectiveTargets[0], 0);
        assertEq(effectiveTargets[1], 6_000);
        assertEq(effectiveTargets[2], 4_000);
        assertEq(uint256(effectiveTargets[0]) + effectiveTargets[1] + effectiveTargets[2], 10_000);
    }

    function testAllRevokedAssetsEnterZeroTargetShutdown() public {
        ManagedOTFVault vault = _createVault();
        assetRegistry.setAssetApproved(address(tokenA), false);
        assetRegistry.setAssetApproved(address(tokenB), false);

        uint16[] memory effectiveTargets = vault.targetWeightsBps();
        assertEq(effectiveTargets[0], 0);
        assertEq(effectiveTargets[1], 0);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnapprovedAsset.selector);
        vault.previewMint(ONE);
    }

    function testRevokedConstituentDustRemainsChallengeableUntilExactZero() public {
        ManagedOTFVault vault = _createVault();
        assetRegistry.setAssetApproved(address(tokenA), false);

        TradeInstruction[] memory partialTrade =
            _singleTrade(address(tokenA), address(tokenB), 500 * ONE - 1, 500 * ONE - 1);
        vault.executeRebalanceTrades(partialTrade);

        assertEq(tokenA.balanceOf(address(vault)), 1);
        assertTrue(vault.isConstituent(address(tokenA)));
        vm.prank(ATTACKER);
        vault.flagOutOfBand();
        assertTrue(vault.challengeActive());

        TradeInstruction[] memory finalDust =
            _singleTrade(address(tokenA), address(tokenB), 1, 1);
        vault.executeRebalanceTrades(finalDust);

        assertFalse(vault.challengeActive());
        assertFalse(vault.isConstituent(address(tokenA)));
        assertEq(vault.assetCount(), 1);
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

    function testExecutorCannotBypassTradeSizeLimit() public {
        VaultInitParams memory params = _defaultParams();
        params.maxTurnoverBps = 500;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        vault.setExecutor(ALICE, true);
        feedA.setRoundData(2, 120_00000000, START, START, 2);
        vault.flagOutOfBand();
        TradeInstruction[] memory oversized =
            _singleTrade(address(tokenA), address(tokenB), 100 * ONE, 100 * ONE);

        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.TurnoverTooHigh.selector);
        vault.executeRebalanceTrades(oversized);
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
        executor.executeTrade(trade);
    }
}
