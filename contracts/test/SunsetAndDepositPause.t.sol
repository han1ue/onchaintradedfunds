// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract SunsetAndDepositPauseTest is ProtocolTestBase {
    function testFactoryOwnerCanPauseAndResumeDepositsAcrossVaults() public {
        ManagedOTFVault first = _createVault();
        ManagedOTFVault second = _createVault();

        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setDepositsPaused(true);

        factory.setDepositsPaused(true);
        assertTrue(factory.depositsPaused());

        vm.expectRevert(OTFFactory.DepositsPaused.selector);
        factory.createVault(_defaultParams());

        vm.expectRevert(ManagedOTFVaultStorage.ProtocolDepositsPaused.selector);
        first.previewMint(ONE);
        vm.expectRevert(ManagedOTFVaultStorage.ProtocolDepositsPaused.selector);
        second.previewMint(ONE);
        uint256[] memory maximums = new uint256[](2);
        vm.expectRevert(ManagedOTFVaultStorage.ProtocolDepositsPaused.selector);
        first.mintWithBasket(ONE, address(this), maximums);

        uint256[] memory minimums = new uint256[](2);
        uint256 sharesBefore = first.balanceOf(address(this));
        first.redeem(ONE, address(this), address(this), minimums);
        assertEq(first.balanceOf(address(this)), sharesBefore - ONE);

        factory.setDepositsPaused(false);
        assertFalse(factory.depositsPaused());
        assertEq(first.previewMint(ONE).length, 2);
        assertEq(second.previewMint(ONE).length, 2);
    }

    function testOnlyManagerCanSunsetAfterCooldownFromIdleStrategyState() public {
        ManagedOTFVault vault = _createVault();

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.sunsetOtf();

        vm.warp(START + 30 days);
        _refreshPrices();
        uint256 supplyBefore = vault.totalSupply();
        uint256 recipientBefore = vault.balanceOf(FEE_RECIPIENT);

        vault.sunsetOtf();

        assertTrue(vault.sunset());
        assertEq(vault.sunsetAt(), START + 30 days);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Sunset));
        assertGt(vault.totalSupply(), supplyBefore);
        assertGt(vault.balanceOf(FEE_RECIPIENT), recipientBefore);
        assertFalse(vault.canProposeStrategy());

        vm.expectRevert(ManagedOTFVaultStorage.VaultAlreadySunset.selector);
        vault.sunsetOtf();
    }

    function testFactoryOwnerCanPauseAndResumeDepositsForOneVault() public {
        ManagedOTFVault pausedVault = _createVault();
        ManagedOTFVault openVault = _createVault();

        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setVaultDepositsPaused(address(pausedVault), true);

        vm.expectPartialRevert(OTFFactory.InvalidVault.selector);
        factory.setVaultDepositsPaused(ALICE, true);

        factory.setVaultDepositsPaused(address(pausedVault), true);
        assertTrue(factory.vaultDepositsPaused(address(pausedVault)));
        assertFalse(factory.vaultDepositsPaused(address(openVault)));

        vm.expectRevert(ManagedOTFVaultStorage.VaultDepositsPaused.selector);
        pausedVault.previewMint(ONE);
        assertEq(openVault.previewMint(ONE).length, 2);

        uint256[] memory minimums = new uint256[](2);
        uint256 sharesBefore = pausedVault.balanceOf(address(this));
        pausedVault.redeem(ONE, address(this), address(this), minimums);
        assertEq(pausedVault.balanceOf(address(this)), sharesBefore - ONE);

        factory.setVaultDepositsPaused(address(pausedVault), false);
        assertFalse(factory.vaultDepositsPaused(address(pausedVault)));
        assertEq(pausedVault.previewMint(ONE).length, 2);
    }

    function testLocalPauseLeavesTransfersFeesStrategiesRebalancesAndChallengesOpen() public {
        ManagedOTFVault vault = _createVault();
        factory.setVaultDepositsPaused(address(vault), true);

        uint256 aliceSharesBefore = vault.balanceOf(ALICE);
        vault.transfer(ALICE, ONE);
        assertEq(vault.balanceOf(ALICE), aliceSharesBefore + ONE);

        vm.warp(START + 1 days);
        _refreshPrices();
        assertGt(vault.accrueFees(), 0);
        assertEq(uint256(vault.feeState()), uint256(ManagedOTFVaultStorage.FeeState.Accruing));

        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);
        assertTrue(vault.strategicRebalanceActive());
        _executeAndComplete(
            vault, _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE)
        );
        assertFalse(vault.strategicRebalanceActive());

        tokenB.mint(address(vault), 10_000 * ONE);
        _refreshPrices();
        vault.flagOutOfBand();
        assertTrue(vault.challengeActive());
        assertTrue(factory.vaultDepositsPaused(address(vault)));
    }

    function testSunsetStopsFutureFeesDepositsChallengesAndStrategyChanges() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 30 days);
        _refreshPrices();
        vault.sunsetOtf();
        uint256 supplyAtSunset = vault.totalSupply();

        vm.warp(START + 365 days);
        _refreshPrices();
        assertEq(vault.accrueFees(), 0);
        assertEq(vault.totalSupply(), supplyAtSunset);

        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.previewMint(ONE);
        uint256[] memory maximums = new uint256[](2);
        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.mintWithBasket(ONE, address(this), maximums);
        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.flagOutOfBand();
        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.setNextStrategyRationale("No strategy changes after sunset.");
        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.setManagerFeeBps(0);
        assertEq(vault.pruneRetiredAssets(), 0);

        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.expectRevert(ManagedOTFVaultStorage.VaultSunset.selector);
        vault.proposeStrategy(assets, _uint256Weights(weights), "No proposal after sunset.");
    }

    function testSunsetKeepsProportionalRedemptionsOpen() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(vault.nextStrategyChangeTime());
        vault.sunsetOtf();

        uint256[] memory minimums = new uint256[](2);
        uint256 sharesBefore = vault.balanceOf(address(this));
        uint256 tokenABefore = tokenA.balanceOf(address(this));
        uint256 tokenBBefore = tokenB.balanceOf(address(this));

        vault.redeem(ONE, address(this), address(this), minimums);

        assertEq(vault.balanceOf(address(this)), sharesBefore - ONE);
        assertGt(tokenA.balanceOf(address(this)), tokenABefore);
        assertGt(tokenB.balanceOf(address(this)), tokenBBefore);
    }

    function testSunsetRequiresStrategyCooldownToFinish() public {
        ManagedOTFVault vault = _createVault();

        vm.expectPartialRevert(ManagedOTFVaultStorage.StrategyChangeCooldownActive.selector);
        vault.sunsetOtf();

        vm.warp(vault.nextStrategyChangeTime());
        vault.sunsetOtf();
        assertTrue(vault.sunset());
    }

    function testSunsetRequiresNoChallengeOrStrategyTransition() public {
        ManagedOTFVault challengedVault = _createVault();
        tokenA.mint(address(challengedVault), 100 * ONE);
        _refreshPrices();
        challengedVault.flagOutOfBand();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        challengedVault.sunsetOtf();

        ManagedOTFVault pendingVault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(pendingVault.nextStrategyChangeTime());
        _refreshPrices();
        pendingVault.proposeStrategy(
            assets, _uint256Weights(weights), "Create a pending strategy transition."
        );
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        pendingVault.sunsetOtf();

        vm.warp(pendingVault.pendingStrategyActivationTime());
        _refreshPrices();
        pendingVault.activatePendingStrategy();
        assertTrue(pendingVault.strategicRebalanceActive());
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        pendingVault.sunsetOtf();
    }
}
