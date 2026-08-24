// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ChallengeAndFeeStateTest is ProtocolTestBase {
    function testPricePumpCanOpenOnlyOneValidChallenge() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);

        vm.prank(ALICE);
        vault.flagOutOfBand();

        assertTrue(vault.challengeActive());
        assertEq(vault.challengeCaller(), ALICE);
        assertEq(vault.challengeStartedAt(), START);
        assertEq(vault.challengeDeadline(), START + 7 days);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Escrowed));

        vm.prank(BOB);
        vm.expectRevert(ManagedOTFVaultStorage.ChallengeAlreadyActive.selector);
        vault.flagOutOfBand();
    }

    function testChallengeCannotBeOpenedInsideChallengeBands() public {
        ManagedOTFVault vault = _createVault();

        vm.expectRevert(ManagedOTFVaultStorage.NoChallengeBreach.selector);
        vault.flagOutOfBand();
    }

    function testChallengeRequiresValidFreshOracles() public {
        ManagedOTFVault vault = _createVault();
        feedA.setRoundData(2, 0, START, START, 2);

        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidOraclePrice.selector);
        vault.flagOutOfBand();

        feedA.setRoundData(3, 120_00000000, START, START, 3);
        vm.warp(START + 30 days + 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StaleOraclePrice.selector);
        vault.flagOutOfBand();
    }

    function testNaturalPriceRecoveryBeforeDeadlineWithdrawsFees() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(START + 1 days);
        _setPrices(100_00000000, 100_00000000);
        vault.resolveOutOfBandChallenge();

        assertFalse(vault.challengeActive());
        assertEq(vault.challengeRewardShares(address(this)), 0);
        assertEq(vault.claimChallengeReward(), 0);
        assertEq(vault.escrowedManagerFeeShares(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), 0);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));

        uint256 recipientBalanceAfterRelease = vault.balanceOf(FEE_RECIPIENT);
        vm.warp(block.timestamp + 1 days);
        _setPrices(100_00000000, 100_00000000);
        assertGt(vault.accrueFees(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), recipientBalanceAfterRelease);
    }

    function testFeesLockOnlyAfterAChallengeStarts() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets,) = _equalPortfolio();
        uint16[] memory weights = new uint16[](2);
        weights[0] = 5_050;
        weights[1] = 4_950;
        _proposeTarget(vault, assets, weights);

        assertFalse(vault.strategicRebalanceActive());
        assertFalse(vault.isWithinTargetBands());
        assertFalse(vault.challengeActive());

        vm.warp(uint256(vault.lastFeeAccrualTimestamp()) + 1 days);
        _refreshPrices();
        uint256 recipientBefore = vault.balanceOf(FEE_RECIPIENT);
        assertGt(vault.accrueFees(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), recipientBefore);
        assertFalse(vault.challengeActive());
        assertEq(vault.escrowedManagerFeeShares(), 0);

        vm.warp(uint256(vault.lastFeeAccrualTimestamp()) + 1 days);
        _refreshPrices();
        assertGt(vault.withdrawManagerFees(), 0);
        assertFalse(vault.challengeActive());

        vm.warp(uint256(vault.lastFeeAccrualTimestamp()) + 1 days);
        _setPrices(120_00000000, 100_00000000);
        uint256 recipientBeforeChallenge = vault.balanceOf(FEE_RECIPIENT);
        assertGt(vault.withdrawManagerFees(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), recipientBeforeChallenge);
        assertTrue(vault.challengeActive());

        vm.warp(uint256(vault.lastFeeAccrualTimestamp()) + 1 days);
        _setPrices(120_00000000, 100_00000000);
        uint256 recipientDuringChallenge = vault.balanceOf(FEE_RECIPIENT);
        uint256 escrowBefore = vault.escrowedManagerFeeShares();
        assertGt(vault.accrueFees(), 0);
        assertEq(vault.balanceOf(FEE_RECIPIENT), recipientDuringChallenge);
        assertGt(vault.escrowedManagerFeeShares(), escrowBefore);
    }

    function testManagerTradesAutomaticallyResolveChallenge() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        TradeInstruction[] memory first =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        TradeInstruction[] memory second =
            _singleTrade(address(tokenA), address(tokenB), 65 * ONE / 3, 26 * ONE - 1);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);
        vault.executeRebalanceTrades(first);
        assertTrue(vault.challengeActive());

        vault.executeRebalanceTrades(second);

        assertFalse(vault.challengeActive());
        assertEq(vault.challengeCaller(), address(0));
        assertEq(vault.challengeDeadline(), 0);
        assertTrue(vault.isWithinTargetBands());
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));

        vm.expectRevert(ManagedOTFVaultStorage.ChallengeNotActive.selector);
        vault.resolveOutOfBandChallenge();
    }

    function testAuthorizedExecutorTradesAutomaticallyResolveChallenge() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);
        _setPrices(120_00000000, 100_00000000);
        vm.prank(BOB);
        vault.flagOutOfBand();

        TradeInstruction[] memory first =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        TradeInstruction[] memory second =
            _singleTrade(address(tokenA), address(tokenB), 65 * ONE / 3, 26 * ONE - 1);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);

        vm.startPrank(ALICE);
        vault.executeRebalanceTrades(first);
        vault.executeRebalanceTrades(second);
        vm.stopPrank();

        assertFalse(vault.challengeActive());
        assertTrue(vault.isWithinTargetBands());
        assertEq(vault.challengeRewardShares(BOB), 0);
    }

    function testPartialCorrectiveTradeLeavesChallengeActiveOutsideCompletionBands() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        TradeInstruction[] memory partialTrades =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);
        vault.executeRebalanceTrades(partialTrades);

        assertTrue(vault.challengeActive());
        assertFalse(vault.isWithinTargetBands());
    }

    function testCorrectiveTradeFailureLeavesChallengeStateAndBalancesUnchanged() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();
        uint256 deadline = vault.challengeDeadline();

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);
        adapter.setFailNextSwap(true);

        vm.expectRevert(MockTradeAdapter.MockSwapFailed.selector);
        vault.executeRebalanceTrades(trades);

        assertTrue(vault.challengeActive());
        assertEq(vault.challengeDeadline(), deadline);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testPinnedStalenessBlocksCorrectiveTradesAndDirectResolution() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();
        vm.warp(block.timestamp + 1 hours + 1);
        assertGt(vault.totalAssetsValue(), 0);

        vm.warp(block.timestamp + 24 hours);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);

        vm.expectPartialRevert(ManagedOTFVaultStorage.StaleOraclePrice.selector);
        vault.executeRebalanceTrades(trades);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StaleOraclePrice.selector);
        vault.resolveOutOfBandChallenge();

        assertTrue(vault.challengeActive());
    }

    function testOverdueCorrectiveTradesPreserveForfeitureAndResolveLate() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vm.prank(ALICE);
        vault.flagOutOfBand();
        uint256 deadline = vault.challengeDeadline();

        vm.warp(deadline + 1);
        _setPrices(120_00000000, 100_00000000);
        TradeInstruction[] memory first =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        TradeInstruction[] memory second =
            _singleTrade(address(tokenA), address(tokenB), 65 * ONE / 3, 26 * ONE - 1);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);

        vault.executeRebalanceTrades(first);
        uint256 forfeited = vault.forfeitedManagerFeeShares();
        uint256 reward = vault.challengeRewardShares(ALICE);
        vault.executeRebalanceTrades(second);

        assertGt(forfeited, 0);
        assertEq(reward, forfeited / 2);
        assertEq(vault.forfeitedManagerFeeShares(), forfeited);
        assertEq(vault.challengeRewardShares(ALICE), reward);
        assertFalse(vault.challengeActive());
        assertEq(vault.lastFeeAccrualTimestamp(), block.timestamp);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));
    }

    function testDeadlineForfeitsChallengeWindowFeesAndCreditsCallerReward() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(START + 1 days);
        _setPrices(120_00000000, 100_00000000);
        assertGt(vault.accrueFees(), 0);
        assertGt(vault.escrowedManagerFeeShares(), 0);

        vm.warp(START + 7 days + 1);
        _setPrices(120_00000000, 100_00000000);
        uint256 initialSupply = 100 * ONE;
        uint256 balanceBeforeReward = vault.balanceOf(address(this));
        uint256 reward = vault.claimChallengeReward();
        uint256 forfeited = vault.forfeitedManagerFeeShares();

        assertGt(forfeited, 0);
        assertEq(vault.escrowedManagerFeeShares(), 0);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Suspended));
        assertEq(reward, forfeited / 2);
        assertEq(vault.lastFeeAccrualTimestamp(), vault.challengeDeadline());
        assertEq(vault.challengeRewardShares(address(this)), 0);
        assertEq(vault.balanceOf(address(this)), balanceBeforeReward + forfeited / 2);
        assertEq(vault.balanceOf(address(collector)), forfeited - reward);
        assertEq(vault.totalSupply(), initialSupply + forfeited);
    }

    function testOverdueChallengePreviewsMatchProcessedTreasuryTransfer() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(vault.challengeDeadline() + 1);
        _setPrices(120_00000000, 100_00000000);

        uint256[] memory contribution = new uint256[](2);
        contribution[0] = 5 * ONE;
        contribution[1] = 5 * ONE;
        uint256 contributionBefore = vault.previewContribute(contribution);
        uint256[] memory mintBefore = vault.previewMint(ONE);
        uint256[] memory withdrawBefore = vault.previewWithdraw(ONE);
        uint256[] memory redeemBefore = vault.previewRedeem(ONE);
        uint256 navPerShareBefore = vault.navPerShare();

        vault.claimChallengeReward();

        assertEq(vault.previewContribute(contribution), contributionBefore);
        uint256[] memory mintAfter = vault.previewMint(ONE);
        uint256[] memory withdrawAfter = vault.previewWithdraw(ONE);
        uint256[] memory redeemAfter = vault.previewRedeem(ONE);
        assertEq(mintAfter[0], mintBefore[0]);
        assertEq(mintAfter[1], mintBefore[1]);
        assertEq(withdrawAfter[0], withdrawBefore[0]);
        assertEq(withdrawAfter[1], withdrawBefore[1]);
        assertEq(redeemAfter[0], redeemBefore[0]);
        assertEq(redeemAfter[1], redeemBefore[1]);
        assertEq(vault.navPerShare(), navPerShareBefore);
    }

    function testOverdueChallengeForfeitureIsOneTimeAndDeadlineBounded() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vm.prank(ALICE);
        vault.flagOutOfBand();
        uint256 deadline = vault.challengeDeadline();

        vm.warp(deadline);
        vm.prank(ALICE);
        assertEq(vault.claimChallengeReward(), 0);
        assertEq(vault.forfeitedManagerFeeShares(), 0);

        vm.warp(block.timestamp + 1);
        uint256 firstBalanceBefore = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 firstReward = vault.claimChallengeReward();

        assertGt(firstReward, 0);
        assertEq(vault.challengeRewardShares(ALICE), 0);
        assertEq(vault.balanceOf(ALICE), firstBalanceBefore + firstReward);
        uint256 forfeitedAfterFirstClaim = vault.forfeitedManagerFeeShares();
        uint256 supplyAfterFirstClaim = vault.totalSupply();

        assertEq(vault.lastFeeAccrualTimestamp(), deadline);
        assertTrue(vault.challengeActive());
        assertEq(vault.challengeCaller(), ALICE);

        vm.warp(block.timestamp + 1 days);
        uint256 secondBalanceBefore = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 secondReward = vault.claimChallengeReward();

        assertEq(secondReward, 0);
        assertEq(vault.forfeitedManagerFeeShares(), forfeitedAfterFirstClaim);
        assertEq(vault.challengeRewardShares(ALICE), 0);
        assertEq(vault.balanceOf(ALICE), secondBalanceBefore);
        assertEq(vault.totalSupply(), supplyAfterFirstClaim);
        assertEq(vault.lastFeeAccrualTimestamp(), deadline);

        // The direct manager-withdrawal path also converges on the same idempotent transition.
        assertEq(vault.withdrawManagerFees(), 0);
        assertEq(vault.forfeitedManagerFeeShares(), forfeitedAfterFirstClaim);
        assertEq(vault.totalSupply(), supplyAfterFirstClaim);
        assertEq(vault.lastFeeAccrualTimestamp(), deadline);
    }

    function testLateChallengePreservesFeesCrystallizedBeforeChallengeStart() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);
        _setPrices(120_00000000, 100_00000000);

        uint256 recipientBalanceBefore = vault.balanceOf(FEE_RECIPIENT);
        uint256 preChallengeFees = vault.accrueFees();
        uint256 recipientBalanceAtChallengeStart = vault.balanceOf(FEE_RECIPIENT);

        assertTrue(vault.challengeActive());
        assertGt(preChallengeFees, 0);
        assertGt(recipientBalanceAtChallengeStart, recipientBalanceBefore);

        vm.warp(block.timestamp + 7 days + 1);
        assertGt(vault.claimChallengeReward(), 0);

        assertGt(vault.forfeitedManagerFeeShares(), 0);
        assertEq(vault.balanceOf(FEE_RECIPIENT), recipientBalanceAtChallengeStart);
    }

    function testDelayedChallengeRewardClaimCheckpointsPendingFeesBeforeMint() public {
        ManagedOTFVault claimVault = _createVault();
        ManagedOTFVault controlVault = _createVault();

        _setPrices(120_00000000, 100_00000000);
        claimVault.flagOutOfBand();
        controlVault.flagOutOfBand();

        vm.warp(claimVault.challengeDeadline() + 1);
        assertEq(block.timestamp, controlVault.challengeDeadline() + 1);
        claimVault.withdrawManagerFees();
        controlVault.withdrawManagerFees();

        uint256 reward = claimVault.challengeRewardShares(address(this));
        assertGt(reward, 0);
        assertEq(controlVault.challengeRewardShares(address(this)), reward);

        _setPrices(100_00000000, 100_00000000);
        claimVault.resolveOutOfBandChallenge();
        controlVault.resolveOutOfBandChallenge();

        assertFalse(claimVault.challengeActive());
        assertFalse(controlVault.challengeActive());
        assertEq(claimVault.challengeRewardShares(address(this)), reward);
        assertEq(controlVault.challengeRewardShares(address(this)), reward);

        vm.warp(block.timestamp + 10 days);
        _setPrices(100_00000000, 100_00000000);

        uint256 controlFees = controlVault.accrueFees();
        uint256 claimedReward = claimVault.claimChallengeReward();
        controlVault.claimChallengeReward();

        assertGt(controlFees, 0);
        assertEq(claimedReward, reward);
        assertEq(claimVault.balanceOf(FEE_RECIPIENT), controlVault.balanceOf(FEE_RECIPIENT));
        assertEq(
            claimVault.balanceOf(address(collector)), controlVault.balanceOf(address(collector))
        );
        assertEq(claimVault.totalSupply(), controlVault.totalSupply());
        assertEq(claimVault.lastFeeAccrualTimestamp(), controlVault.lastFeeAccrualTimestamp());
    }

    function testEmptyRewardClaimDoesNotForceFeeAccrual() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);

        uint256 supplyBefore = vault.totalSupply();
        assertEq(vault.claimChallengeReward(), 0);

        assertEq(vault.totalSupply(), supplyBefore);
        assertEq(vault.lastFeeAccrualTimestamp(), START);
    }

    function testRestorationAfterDeadlineResumesOnlyFutureFees() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();
        vm.warp(START + 7 days + 1);
        _setPrices(120_00000000, 100_00000000);
        vault.claimChallengeReward();
        uint256 supplyAtForfeiture = vault.totalSupply();

        _setPrices(100_00000000, 100_00000000);
        vault.resolveOutOfBandChallenge();
        assertEq(vault.totalSupply(), supplyAtForfeiture);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));

        vm.warp(block.timestamp + 1 days);
        _setPrices(100_00000000, 100_00000000);
        vault.accrueFees();
        assertGt(vault.totalSupply(), supplyAtForfeiture);
    }

    function testDepositsAndWithdrawalsRemainEnabledDuringActiveAndOverdueChallenge() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(START + 1 days);
        _setPrices(120_00000000, 100_00000000);
        _mintForAlice(vault, 5 * ONE);
        uint256 escrowAfterDeposit = vault.escrowedManagerFeeShares();
        assertGt(escrowAfterDeposit, 0);
        assertEq(vault.lastFeeAccrualTimestamp(), block.timestamp);

        vm.warp(START + 2 days);
        _setPrices(120_00000000, 100_00000000);
        uint256[] memory minimums = new uint256[](2);
        vm.prank(ALICE);
        vault.redeem(ONE, ALICE, ALICE, minimums);
        assertGt(vault.escrowedManagerFeeShares(), escrowAfterDeposit);
        assertEq(vault.lastFeeAccrualTimestamp(), block.timestamp);

        vm.warp(START + 7 days + 1);
        _setPrices(120_00000000, 100_00000000);
        _mintForAlice(vault, 5 * ONE);
        vm.prank(ALICE);
        vault.redeem(ONE, ALICE, ALICE, minimums);

        assertTrue(vault.challengeActive());
        assertGt(vault.balanceOf(ALICE), 0);
    }

    function testManagerCannotChangeTargetsDuringChallengeOrOutsideCompletionBands() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory narrowWeights) = _sixtyFortyPortfolio();
        uint256[] memory weights = _uint256Weights(narrowWeights);
        vm.warp(START + 14 days);
        _setPrices(120_00000000, 100_00000000);

        vm.expectRevert(ManagedOTFVaultStorage.TargetBandsNotReached.selector);
        vault.proposeStrategy(assets, weights, "Challenge-state target update.");

        vault.flagOutOfBand();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        vault.proposeStrategy(assets, weights, "Challenge-state target update.");
    }

    function testUnfinishedStrategicTargetCannotBeRedefinedAndFeeWithdrawStartsChallenge() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory narrowWeights) = _sixtyFortyPortfolio();
        uint256[] memory weights = _uint256Weights(narrowWeights);
        vm.warp(START + 14 days);
        _setPrices(100_00000000, 100_00000000);
        vault.proposeStrategy(assets, weights, "Challenge-state target update.");

        vm.expectRevert(ManagedOTFVaultStorage.PendingStrategyExists.selector);
        vault.proposeStrategy(assets, weights, "Challenge-state target update.");

        vm.warp(START + 16 days);
        _setPrices(100_00000000, 100_00000000);
        vault.activatePendingStrategy();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        vault.proposeStrategy(assets, weights, "Challenge-state target update.");

        vm.warp(START + 17 days);
        _setPrices(100_00000000, 100_00000000);
        uint256 recipientBalanceBeforeChallenge = vault.balanceOf(FEE_RECIPIENT);
        assertGt(vault.accrueFees(), 0);
        assertTrue(vault.challengeActive());
        assertGt(vault.balanceOf(FEE_RECIPIENT), recipientBalanceBeforeChallenge);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE);
        vault.executeRebalanceTrades(trades);
        assertFalse(vault.challengeActive());
        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.escrowedManagerFeeShares(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), 0);
    }

    function testBandBoundariesAreInclusive() public {
        ManagedOTFVault vault = _createVault();
        // A/B = 105/95 gives A exactly 52.5%, the upper challenge boundary.
        _setPrices(105_00000000, 95_00000000);

        assertTrue(vault.isWithinChallengeBands());
        vm.expectRevert(ManagedOTFVaultStorage.NoChallengeBreach.selector);
        vault.flagOutOfBand();

        _setPrices(105_00000001, 95_00000000);
        assertFalse(vault.isWithinChallengeBands());
    }

    function testUnchallengedStrategyCompletesPermissionlesslyInsideWiderBands() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);
        assertTrue(vault.strategicRebalanceActive());

        _setPrices(138_00000000, 100_00000000);
        assertTrue(vault.isWithinChallengeBands());
        assertFalse(vault.isWithinTargetBands());

        vm.prank(ALICE);
        vault.completeStrategicRebalance();

        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.rebalanceCount(), 1);
    }

    function testSuccessfulTradeAutomaticallyCompletesInsideWiderBands() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 80 * ONE, 80 * ONE);
        vault.executeRebalanceTrades(trades);

        assertFalse(vault.strategicRebalanceActive());
        assertFalse(vault.isWithinTargetBands());
        assertTrue(vault.isWithinChallengeBands());
    }

    function testActivationCompletesWhenNewTargetsAlreadyMeetWiderBands() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets,) = _equalPortfolio();
        uint16[] memory weights = new uint16[](2);
        weights[0] = 5_200;
        weights[1] = 4_800;

        _proposeTarget(vault, assets, weights);

        assertFalse(vault.strategicRebalanceActive());
        assertEq(vault.rebalanceCount(), 1);
    }

    function testChallengedStrategyRequiresTightBandsBeforeResolution() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);
        vault.flagOutOfBand();

        _setPrices(138_00000000, 100_00000000);
        assertTrue(vault.isWithinChallengeBands());
        assertFalse(vault.isWithinTargetBands());
        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.TargetBandsNotReached.selector);
        vault.completeStrategicRebalance();
        assertTrue(vault.challengeActive());
        assertTrue(vault.strategicRebalanceActive());

        _setPrices(150_00000000, 100_00000000);
        vm.prank(ALICE);
        vault.completeStrategicRebalance();
        assertFalse(vault.challengeActive());
        assertFalse(vault.strategicRebalanceActive());
    }

    function testCompletedStrategyCanLaterBeChallengedOutsideWiderBands() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);
        _setPrices(138_00000000, 100_00000000);
        vault.completeStrategicRebalance();

        _setPrices(100_00000000, 100_00000000);
        vm.prank(BOB);
        vault.flagOutOfBand();

        assertTrue(vault.challengeActive());
        assertEq(vault.challengeCaller(), BOB);
    }

    function testDepositsAndProportionalRedemptionsRemainOracleIndependent() public {
        ManagedOTFVault vault = _createVault();
        feedA.setRoundData(2, 0, START, START, 2);
        feedB.setRoundData(2, 0, START, START, 2);

        _mintForAlice(vault, 5 * ONE);
        uint256[] memory minimums = new uint256[](2);
        vm.prank(ALICE);
        vault.redeem(ONE, ALICE, ALICE, minimums);

        assertEq(vault.balanceOf(ALICE), 4 * ONE);
        assertGt(tokenA.balanceOf(ALICE), 0);
        assertGt(tokenB.balanceOf(ALICE), 0);
    }

    function _setPrices(int256 priceA, int256 priceB) private {
        uint80 roundA = feedA.roundId() + 1;
        uint80 roundB = feedB.roundId() + 1;
        feedA.setRoundData(roundA, priceA, block.timestamp, block.timestamp, roundA);
        feedB.setRoundData(roundB, priceB, block.timestamp, block.timestamp, roundB);
    }

    function _mintForAlice(ManagedOTFVault vault, uint256 shares) private {
        uint256[] memory amounts = vault.previewMint(shares);
        tokenA.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), 0);
        tokenB.approve(address(vault), 0);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, amounts);
        vm.stopPrank();
    }
}
