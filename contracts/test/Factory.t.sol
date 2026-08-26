// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { MockTradeAdapter } from "./mocks/MockTradeAdapter.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract FactoryTest is ProtocolTestBase {
    function testFactoryCreatesAndEnumeratesVault() public {
        VaultInitParams memory params = _defaultParams();
        address created = factory.createVault(params);

        assertTrue(created != address(0));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), created);
        assertTrue(factory.isVault(created));
        assertEq(ManagedOTFVault(created).factory(), address(factory));
    }

    function testOwnerCanUpdateChallengeGracePeriod() public {
        assertEq(factory.challengeGracePeriod(), 7 days);
        assertEq(factory.MIN_CHALLENGE_GRACE_PERIOD(), 1 days);
        assertEq(factory.MAX_CHALLENGE_GRACE_PERIOD(), 30 days);

        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setChallengeGracePeriod(3 days);

        factory.setChallengeGracePeriod(3 days);
        assertEq(factory.challengeGracePeriod(), 3 days);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setChallengeGracePeriod(1 days - 1);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setChallengeGracePeriod(30 days + 1);
    }

    function testFactoryCreatesDistinctClonesForIdenticalParams() public {
        VaultInitParams memory params = _defaultParams();
        address first = factory.createVault(params);
        address second = factory.createVault(params);

        assertTrue(first != second);
        assertEq(factory.vaultCount(), 2);
    }

    function testFactoryRejectsManagerFeeAboveGlobalMaximum() public {
        VaultInitParams memory params = _defaultParams();
        params.managerFeeBpsPerYear = 2_001;

        vm.expectPartialRevert(OTFFactory.ManagerFeeTooHigh.selector);
        factory.createVault(params);
    }

    function testFactoryAcceptsInitialShareSupplyAtMaximum() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = 1_000_000 * ONE;

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.totalSupply(), 1_000_000 * ONE);
        assertEq(factory.MAX_INITIAL_SHARE_SUPPLY(), 1_000_000 * ONE);
    }

    function testFactoryRejectsInitialShareSupplyAboveMaximum() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = 1_000_000 * ONE + 1;

        vm.expectPartialRevert(OTFFactory.InitialShareSupplyTooLarge.selector);
        factory.createVault(params);
    }

    function testFactoryAcceptsManagerFeeAtGlobalMaximum() public {
        VaultInitParams memory params = _defaultParams();
        params.managerFeeBpsPerYear = 2_000;

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.managerFeeBpsPerYear(), 2_000);
        assertEq(2_000, 2_000);
        assertEq(factory.MAX_MANAGER_FEE_BPS_PER_YEAR(), 2_000);
    }

    function testFactoryRejectsMoreThanMaximumTrackedAssetsBeforeTransfers() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](101);

        vm.expectRevert(OTFFactory.TrackedAssetLimitExceeded.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsEmptyInitialStrategyRationale() public {
        VaultInitParams memory params = _defaultParams();
        params.initialStrategyRationale = "";

        vm.expectRevert(OTFFactory.StrategyRationaleRequired.selector);
        factory.createVault(params);
    }

    function testFactoryRequiresOTFNameSuffix() public {
        VaultInitParams memory params = _defaultParams();
        params.name = "Test Fund";

        vm.expectRevert(OTFFactory.InvalidOTFName.selector);
        factory.createVault(params);

        params.name = "Test otf";
        vm.expectRevert(OTFFactory.InvalidOTFName.selector);
        factory.createVault(params);

        params.name = "TestOTF";
        vm.expectRevert(OTFFactory.InvalidOTFName.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsMismatchedArrays() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAmounts = new uint256[](1);
        params.initialAmounts[0] = 500 * ONE;

        vm.expectRevert(OTFFactory.InvalidArrayLength.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsLimitsAboveGlobalBounds() public {
        VaultInitParams memory params = _defaultParams();
        params.maxNavLossBps = 201;
        vm.expectRevert(OTFFactory.LimitTooHigh.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.maxWeightDeviationBps = 501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsInvalidZeroLimits() public {
        VaultInitParams memory params = _defaultParams();
        params.maxWeightDeviationBps = 0;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
    }

    function testVaultUsesProtocolWideMinimumTargetWeight() public {
        assertEq(factory.minTargetWeightBps(), 100);

        VaultInitParams memory params = _defaultParams();
        params.initialTargetWeightsBps[0] = 9_950;
        params.initialTargetWeightsBps[1] = 50;

        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooLow.selector);
        factory.createVault(params);

        ManagedOTFVault vault = _createVault();

        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setMinTargetWeightBps(200);

        factory.setMinTargetWeightBps(6_000);
        assertFalse(vault.challengeActive());
        assertEq(vault.targetWeightBps(address(tokenA)), 5_000);
        assertEq(vault.targetWeightBps(address(tokenB)), 5_000);

        factory.setMinTargetWeightBps(200);
        assertEq(factory.minTargetWeightBps(), 200);

        vm.warp(START + 14 days);
        _refreshPrices();
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory weights = new uint256[](2);
        weights[0] = 9_801;
        weights[1] = 199;
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooLow.selector);
        vault.proposeStrategy(assets, weights, "Target below the updated protocol minimum.");

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setMinTargetWeightBps(0);
    }

    function testFactoryDefaultsToOnePercentAndAllowsHardFloor() public {
        assertEq(factory.MIN_TARGET_WEIGHT_BPS(), 10);
        assertEq(factory.minTargetWeightBps(), 100);

        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.setMinTargetWeightBps(9);
        assertEq(factory.minTargetWeightBps(), 100);

        factory.setMinTargetWeightBps(10);
        assertEq(factory.minTargetWeightBps(), 10);
    }

    function testStrategyCanUseHardFloorButCannotProposeZeroWeight() public {
        ManagedOTFVault vault = _createVault();
        factory.setMinTargetWeightBps(10);

        vm.warp(START + 14 days);
        _refreshPrices();
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory weights = new uint256[](2);
        weights[0] = 10_000;

        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetWeightTooLow.selector);
        vault.proposeStrategy(assets, weights, "Zero is not a valid constituent target.");

        weights[0] = 9_990;
        weights[1] = 10;
        vault.proposeStrategy(assets, weights, "Use the protocol hard-floor allocation.");
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        assertEq(vault.targetWeightBps(address(tokenA)), 9_990);
        assertEq(vault.targetWeightBps(address(tokenB)), 10);
    }

    function testFactoryAllowsSingleAssetPortfolio() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](1);
        params.initialAssets[0] = address(tokenA);
        params.initialPricingConfigs = _pricingConfigsFor(params.initialAssets);
        params.initialTargetWeightsBps = new uint16[](1);
        params.initialTargetWeightsBps[0] = 10_000;
        params.initialAmounts = new uint256[](1);
        params.initialAmounts[0] = 1_000 * ONE;

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.totalConstituents(), 1);
        assertEq(vault.targetWeightBps(address(tokenA)), 10_000);
    }

    function testFactoryRejectsInvalidChallengeConfiguration() public {
        VaultInitParams memory params = _defaultParams();
        params.challengeWeightDeviationBps = params.maxWeightDeviationBps;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeWeightDeviationBps = 1_501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
    }

    function testVaultPinsCreatorSelectedStaleness() public {
        ManagedOTFVault vault = _createVault();
        (,,,,,, uint32 primaryMaxStaleness,) = vault.pricingConfigForAsset(address(tokenA));
        assertEq(primaryMaxStaleness, 25 hours);
        assertEq(vault.totalAssetsValue(), 100_000 * ONE);
    }

    function testVaultPinsRobinhoodSourcePauseCheck() public {
        ManagedOTFVault vault = _createVault();
        tokenA.setOraclePaused(true);

        vm.expectPartialRevert(ManagedOTFVaultStorage.OraclePaused.selector);
        vault.totalAssetsValue();

        tokenA.setOraclePaused(false);
        assertEq(vault.totalAssetsValue(), 100_000 * ONE);
    }

    function testFactoryCreationIsAtomicWhenVaultInitializationFails() public {
        VaultInitParams memory params = _defaultParams();
        params.initialTargetWeightsBps[0] = 6_000;
        uint256 tokenBalanceBefore = tokenA.balanceOf(address(this));

        vm.expectPartialRevert(IERC7621.InvalidWeights.selector);
        factory.createVault(params);

        assertEq(factory.vaultCount(), 0);
        assertEq(tokenA.balanceOf(address(this)), tokenBalanceBefore);
    }

    function testOnlyOwnerCanApproveAdapters() public {
        vm.prank(ATTACKER);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setTradeAdapterApproved(address(adapter), false);

        factory.setTradeAdapterApproved(address(adapter), false);
        assertFalse(factory.isTradeAdapterApproved(address(adapter)));
    }

    function testTradeAdapterCanBeRevokedAfterItsCodeDisappears() public {
        address retiredAdapter = address(adapter);
        assertTrue(factory.isTradeAdapterApproved(retiredAdapter));

        vm.etch(retiredAdapter, bytes(""));
        factory.setTradeAdapterApproved(retiredAdapter, false);
        assertFalse(factory.isTradeAdapterApproved(retiredAdapter));

        vm.expectRevert(
            abi.encodeWithSelector(OTFFactory.InvalidDependency.selector, retiredAdapter)
        );
        factory.setTradeAdapterApproved(retiredAdapter, true);

        MockTradeAdapter replacement = new MockTradeAdapter();
        factory.setTradeAdapterApproved(address(replacement), true);
        assertTrue(factory.isTradeAdapterApproved(address(replacement)));
    }

    function testFactoryOwnershipTransferRequiresPendingOwner() public {
        factory.beginOwnershipTransfer(ALICE);
        vm.prank(BOB);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.acceptOwnershipTransfer();

        vm.prank(ALICE);
        factory.acceptOwnershipTransfer();
        assertEq(factory.owner(), ALICE);
        assertEq(factory.pendingOwner(), address(0));
    }

    function testFeeCollectorTreasuryAuthority() public {
        assertEq(collector.treasury(), TREASURY);

        vm.prank(TREASURY);
        collector.beginTreasuryTransfer(ALICE);
        assertEq(collector.pendingTreasury(), ALICE);

        vm.prank(BOB);
        vm.expectRevert(FeeCollector.NotPendingTreasury.selector);
        collector.acceptTreasuryTransfer();

        vm.prank(ALICE);
        collector.acceptTreasuryTransfer();
        assertEq(collector.treasury(), ALICE);
        assertEq(collector.pendingTreasury(), address(0));
    }

    function testExecutorFactoryCanOnlyBeSetOnceByOwner() public {
        RebalanceExecutor freshExecutor = new RebalanceExecutor(address(this));

        vm.prank(ATTACKER);
        vm.expectRevert(RebalanceExecutor.NotOwner.selector);
        freshExecutor.setFactory(address(factory));

        vm.expectPartialRevert(RebalanceExecutor.InvalidFactory.selector);
        freshExecutor.setFactory(ALICE);

        freshExecutor.setFactory(address(factory));
        vm.expectRevert(RebalanceExecutor.FactoryAlreadySet.selector);
        freshExecutor.setFactory(address(factory));
    }

    function testRebalanceExecutorConstructorRejectsZeroOwner() public {
        vm.expectRevert(RebalanceExecutor.ZeroAddress.selector);
        new RebalanceExecutor(address(0));
    }

    function testFactoryRejectsNonContractDependencies() public {
        address implementation = factory.vaultImplementation();
        address pricingResolver = factory.pricingResolver();
        vm.expectPartialRevert(OTFFactory.InvalidDependency.selector);
        new OTFFactory(implementation, address(collector), ALICE, pricingResolver, 1_500);
    }
}
