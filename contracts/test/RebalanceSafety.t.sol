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
        vm.warp(START + 7 days);

        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.rebalance(assets, _uint256Weights(weights));
    }

    function testTargetProposalDoesNotExecuteOrCompleteTrades() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 7 days);

        _proposeTarget(vault, assets, weights);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertTrue(vault.strategicRebalanceActive());
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Escrowed));
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
        vm.warp(START + 7 days);

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
        assertEq(vault.lastRebalanceTimestamp(), START + 7 days);
        assertEq(vault.lastCompletedStrategicRebalance(), START + 7 days);

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
        vm.warp(START + 7 days);
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
        vm.warp(START + 7 days);
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
        vm.warp(START + 7 days);

        vm.expectPartialRevert(ManagedOTFVaultStorage.TurnoverTooHigh.selector);
        _proposeTarget(vault, assets, weights);
        assertEq(vault.lastRebalanceTimestamp(), START);
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
        vm.warp(START + 7 days);

        address[] memory emptyAssets = new address[](0);
        uint256[] memory emptyWeights = new uint256[](0);
        vm.expectRevert(ManagedOTFVaultStorage.EmptyPortfolio.selector);
        vault.rebalance(emptyAssets, emptyWeights);

        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenA);
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5_000;
        weights[1] = 5_000;
        vm.expectPartialRevert(IERC7621.DuplicateConstituent.selector);
        vault.rebalance(assets, weights);

        assets[1] = address(tokenB);
        weights[0] = 5_001;
        vm.expectPartialRevert(IERC7621.InvalidWeights.selector);
        vault.rebalance(assets, weights);

        weights[0] = 9_900;
        weights[1] = 100;
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooHigh.selector);
        vault.rebalance(assets, weights);
    }

    function testConstituentCannotBeRemovedWithAReserve() public {
        VaultInitParams memory params = _defaultParams();
        params.maxSingleAssetWeightBps = 10_000;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10_000;
        vm.warp(START + 7 days);

        vm.expectPartialRevert(ManagedOTFVaultStorage.RemovedAssetBalanceRemaining.selector);
        vault.rebalance(assets, weights);
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
        vm.warp(START + 7 days);
        _proposeTarget(vault, assets, weights);

        vm.prank(ALICE);
        vault.executeRebalanceTrades(trades);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.rebalance(assets, _uint256Weights(weights));

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
        vault.appendThesisAmendment("executor cannot amend strategy");

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.transferOwnership(BOB);

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.beginFeeRecipientTransfer(BOB);
    }

    function testManagerCanAuthorizeAndRemoveMultipleExecutors() public {
        ManagedOTFVault vault = _createVault();

        vault.setExecutor(ALICE, true);
        vault.setExecutor(BOB, true);

        assertTrue(vault.authorizedExecutor(ALICE));
        assertTrue(vault.authorizedExecutor(BOB));
        assertEq(vault.authorizedExecutors().length, 2);

        vault.setExecutor(ALICE, false);

        assertFalse(vault.authorizedExecutor(ALICE));
        assertTrue(vault.authorizedExecutor(BOB));
        address[] memory remaining = vault.authorizedExecutors();
        assertEq(remaining.length, 1);
        assertEq(remaining[0], BOB);
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
        vm.warp(START + 7 days);
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
        vault.beginManagerTransfer(BOB);
        vm.prank(BOB);
        vault.acceptManagerTransfer();

        assertFalse(vault.authorizedExecutor(ALICE));
        assertEq(vault.authorizedExecutors().length, 0);
        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotTradeAuthority.selector);
        vault.executeRebalanceTrades(trades);
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
