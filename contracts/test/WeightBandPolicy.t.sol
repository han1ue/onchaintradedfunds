// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract WeightBandPolicyTest is ProtocolTestBase {
    event WeightBandLimitsUpdated(
        uint16 minCompletionDeviationBps,
        uint16 maxCompletionDeviationBps,
        uint16 minChallengeDeviationGapBps,
        uint16 maxChallengeDeviationBps
    );

    function testInitialWeightBandPolicy() public view {
        assertEq(factory.minCompletionDeviationBps(), 25);
        assertEq(factory.maxCompletionDeviationBps(), 500);
        assertEq(factory.minChallengeDeviationGapBps(), 25);
        assertEq(factory.maxChallengeDeviationBps(), 1_500);
    }

    function testOnlyOwnerCanUpdateWeightBandPolicyAndUpdateEmits() public {
        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setWeightBandLimits(50, 400, 50, 1_000);

        vm.expectEmit(false, false, false, true, address(factory));
        emit WeightBandLimitsUpdated(50, 400, 50, 1_000);
        factory.setWeightBandLimits(50, 400, 50, 1_000);

        assertEq(factory.minCompletionDeviationBps(), 50);
        assertEq(factory.maxCompletionDeviationBps(), 400);
        assertEq(factory.minChallengeDeviationGapBps(), 50);
        assertEq(factory.maxChallengeDeviationBps(), 1_000);
    }

    function testInvalidWeightBandPoliciesRevert() public {
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(0, 500, 25, 1_500);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(501, 500, 25, 1_500);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(25, 500, 0, 1_500);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(25, 500, 25, 524);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(25, 10_001, 25, 10_000);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(25, 500, 10_001, 10_000);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setWeightBandLimits(25, 500, 25, 10_001);
    }

    function testCreationAcceptsExactPolicyBoundaries() public {
        VaultInitParams memory minimums = _defaultParams();
        minimums.maxWeightDeviationBps = 25;
        minimums.challengeWeightDeviationBps = 50;
        ManagedOTFVault minimumVault = ManagedOTFVault(factory.createVault(minimums));
        assertEq(minimumVault.maxWeightDeviationBps(), 25);
        assertEq(minimumVault.challengeWeightDeviationBps(), 50);

        VaultInitParams memory maximums = _defaultParams();
        maximums.maxWeightDeviationBps = 500;
        maximums.challengeWeightDeviationBps = 1_500;
        ManagedOTFVault maximumVault = ManagedOTFVault(factory.createVault(maximums));
        assertEq(maximumVault.maxWeightDeviationBps(), 500);
        assertEq(maximumVault.challengeWeightDeviationBps(), 1_500);
    }

    function testCreationRejectsValuesOutsideCurrentPolicy() public {
        VaultInitParams memory params = _defaultParams();
        params.maxWeightDeviationBps = 24;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.maxWeightDeviationBps = 501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeWeightDeviationBps = 49;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeWeightDeviationBps = 1_501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
    }

    function testManagerCanChangeBandsButNonManagerCannot() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 14 days);
        _refreshPrices();

        vm.prank(ALICE);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setWeightBands(100, 250);

        vault.setWeightBands(100, 250);
        assertEq(vault.maxWeightDeviationBps(), 100);
        assertEq(vault.challengeWeightDeviationBps(), 250);
    }

    function testPolicyUpdateDoesNotChangeExistingBandsAndAppliesToLaterManagerChange() public {
        ManagedOTFVault vault = _createVault();
        assertEq(vault.maxWeightDeviationBps(), 25);
        assertEq(vault.challengeWeightDeviationBps(), 250);

        factory.setWeightBandLimits(100, 300, 50, 500);
        assertEq(vault.maxWeightDeviationBps(), 25);
        assertEq(vault.challengeWeightDeviationBps(), 250);

        vm.warp(START + 14 days);
        _refreshPrices();
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidWeightBands.selector);
        vault.setWeightBands(99, 200);

        vault.setWeightBands(100, 150);
        assertEq(vault.maxWeightDeviationBps(), 100);
        assertEq(vault.challengeWeightDeviationBps(), 150);
    }

    function testWeightBandChangesKeepCooldownChallengeAndRebalanceRestrictions() public {
        ManagedOTFVault cooldownVault = _createVault();
        vm.expectPartialRevert(ManagedOTFVaultStorage.StrategyChangeCooldownActive.selector);
        cooldownVault.setWeightBands(100, 250);

        ManagedOTFVault challengeVault = _createVault();
        uint80 roundA = feedA.roundId() + 1;
        feedA.setRoundData(roundA, 120_00000000, block.timestamp, block.timestamp, roundA);
        challengeVault.flagOutOfBand();
        vm.warp(START + 14 days);
        _refreshPrices();
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        challengeVault.setWeightBands(100, 250);

        roundA = feedA.roundId() + 1;
        uint80 roundB = feedB.roundId() + 1;
        feedA.setRoundData(roundA, 100_00000000, block.timestamp, block.timestamp, roundA);
        feedB.setRoundData(roundB, 100_00000000, block.timestamp, block.timestamp, roundB);
        ManagedOTFVault rebalanceVault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(rebalanceVault, assets, weights);
        vm.expectRevert(ManagedOTFVaultStorage.StrategyStateLocked.selector);
        rebalanceVault.setWeightBands(100, 250);
    }
}
