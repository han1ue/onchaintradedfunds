// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
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
        assertEq(vault.challengeDeadline(), START + 3 days);
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

    function testNaturalPriceRecoveryBeforeDeadlineReleasesEscrow() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(START + 1 days);
        _setPrices(100_00000000, 100_00000000);
        vault.resolveOutOfBandChallenge();

        assertFalse(vault.challengeActive());
        assertEq(vault.escrowedManagerFeeShares(), 0);
        assertGt(vault.balanceOf(FEE_RECIPIENT), 0);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));
    }

    function testPartialManagerTradesCanResolveChallenge() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        TradeInstruction[] memory first =
            _singleTrade(address(tokenA), address(tokenB), 20 * ONE, 24 * ONE);
        TradeInstruction[] memory second =
            _singleTrade(address(tokenA), address(tokenB), 65 * ONE / 3, 26 * ONE - 1);
        adapter.setRate(address(tokenA), address(tokenB), 12, 10);
        vault.executeRebalanceTrades(first);
        vault.executeRebalanceTrades(second);
        vault.resolveOutOfBandChallenge();

        assertFalse(vault.challengeActive());
        assertTrue(vault.isWithinTargetBands());
    }

    function testDeadlineForfeitsEscrowAndSuspendsFutureAccrual() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();

        vm.warp(START + 1 days);
        _setPrices(120_00000000, 100_00000000);
        vault.accrueFees();
        uint256 escrowBefore = vault.escrowedManagerFeeShares();
        assertGt(escrowBefore, 0);

        vm.warp(START + 3 days + 1);
        _setPrices(120_00000000, 100_00000000);
        vault.syncChallengeDeadline();
        uint256 supplyWhenSuspended = vault.totalSupply();

        assertEq(vault.escrowedManagerFeeShares(), 0);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Suspended));

        vm.warp(START + 10 days);
        _setPrices(120_00000000, 100_00000000);
        vault.accrueFees();
        assertEq(vault.totalSupply(), supplyWhenSuspended);
    }

    function testRestorationAfterDeadlineResumesOnlyFutureFees() public {
        ManagedOTFVault vault = _createVault();
        _setPrices(120_00000000, 100_00000000);
        vault.flagOutOfBand();
        vm.warp(START + 3 days + 1);
        _setPrices(120_00000000, 100_00000000);
        vault.syncChallengeDeadline();
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

        _mintForAlice(vault, 5 * ONE);
        uint256[] memory minimums = new uint256[](2);
        vm.prank(ALICE);
        vault.redeem(ONE, ALICE, ALICE, minimums);

        vm.warp(START + 3 days + 1);
        _setPrices(120_00000000, 100_00000000);
        vault.syncChallengeDeadline();
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
        vault.rebalance(assets, weights);

        vault.flagOutOfBand();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        vault.rebalance(assets, weights);
    }

    function testUnfinishedStrategicTargetCannotBeRedefinedAndFeesAreEscrowed() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory narrowWeights) = _sixtyFortyPortfolio();
        uint256[] memory weights = _uint256Weights(narrowWeights);
        vm.warp(START + 14 days);
        _setPrices(100_00000000, 100_00000000);
        vault.rebalance(assets, weights);

        vm.expectRevert(ManagedOTFVaultStorage.PendingStrategyExists.selector);
        vault.rebalance(assets, weights);

        vm.warp(START + 16 days);
        vault.activatePendingStrategy();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        vault.rebalance(assets, weights);

        vm.warp(START + 17 days);
        _setPrices(100_00000000, 100_00000000);
        vault.accrueFees();
        assertGt(vault.escrowedManagerFeeShares(), 0);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE);
        vault.executeRebalanceTrades(trades);
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
