// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetRegistry } from "../src/AssetRegistry.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract FactoryTest is ProtocolTestBase {
    function testFactoryRejectsZeroDeploymentSalt() public {
        VaultInitParams memory params = _defaultParams();
        params.deploymentSalt = bytes32(0);

        vm.expectRevert(OTFFactory.InvalidDeploymentSalt.selector);
        factory.createVault(params);
    }

    function testDeploymentSaltChangesPredictedAddressWithoutChangingConfiguration() public view {
        VaultInitParams memory first = _defaultParams();
        VaultInitParams memory second = _defaultParams();
        second.deploymentSalt = keccak256("another-deployment");

        address firstAddress = factory.predictVaultAddress(address(this), 0, first);
        address secondAddress = factory.predictVaultAddress(address(this), 0, second);
        assertTrue(firstAddress != secondAddress);
    }

    function testFactoryCreatesAndEnumeratesVault() public {
        VaultInitParams memory params = _defaultParams();
        address predicted = factory.predictVaultAddress(address(this), 0, params);
        address created = factory.createVault(params);

        assertEq(created, predicted);
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), created);
        assertEq(factory.allVaults()[0], created);
        assertEq(factory.creatorOf(created), address(this));
        assertEq(factory.creatorNonce(address(this)), 1);
        assertTrue(factory.isVault(created));
        assertEq(ManagedOTFVault(created).factory(), address(factory));
    }

    function testFactoryUsesDistinctNonceForIdenticalParams() public {
        VaultInitParams memory params = _defaultParams();
        address first = factory.createVault(params);
        address second = factory.createVault(params);

        assertTrue(first != second);
        assertEq(factory.vaultCount(), 2);
        assertEq(factory.creatorNonce(address(this)), 2);
    }

    function testFactoryRejectsCreatorFeeAboveGlobalMaximum() public {
        VaultInitParams memory params = _defaultParams();
        params.creatorFeeBpsPerYear = 9_001;

        vm.expectPartialRevert(OTFFactory.CreatorFeeTooHigh.selector);
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
        params.maxWeightDeviationBps = 1_001;
        vm.expectRevert(OTFFactory.LimitTooHigh.selector);
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

        assertEq(vault.assetCount(), 1);
        assertEq(vault.targetWeightBps(address(tokenA)), 10_000);
    }

    function testFactoryRejectsInvalidChallengeConfiguration() public {
        VaultInitParams memory params = _defaultParams();
        params.challengeWeightDeviationBps = params.maxWeightDeviationBps;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeWeightDeviationBps = 2_501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
    }

    function testVaultUsesProtocolWideTimingRules() public {
        ManagedOTFVault vault = _createVault();
        assertEq(vault.CHALLENGE_GRACE_PERIOD(), 7 days);
    }

    function testVaultPinsCreatorSelectedStaleness() public {
        ManagedOTFVault vault = _createVault();
        assertEq(vault.maxStalenessForAsset(address(tokenA)), 25 hours);
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
        assertEq(factory.creatorNonce(address(this)), 0);
        assertEq(tokenA.balanceOf(address(this)), tokenBalanceBefore);
    }

    function testAssetDiscoveryIsPermissionlessAndOnlyOwnerCanApproveAdapters() public {
        MockStockToken discovered = new MockStockToken("Discovered", "DISC", 18);
        vm.prank(ATTACKER);
        assetRegistry.registerAsset(address(discovered));
        assertTrue(assetRegistry.isRegisteredAsset(address(discovered)));

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

    function testProtocolTreasuryViewsFollowFeeCollectorAuthority() public {
        assertEq(factory.protocolTreasury(), TREASURY);

        vm.prank(TREASURY);
        collector.beginTreasuryTransfer(ALICE);
        assertEq(factory.pendingProtocolTreasury(), ALICE);

        vm.prank(BOB);
        vm.expectRevert(FeeCollector.NotPendingTreasury.selector);
        collector.acceptTreasuryTransfer();

        vm.prank(ALICE);
        collector.acceptTreasuryTransfer();
        assertEq(factory.protocolTreasury(), ALICE);
        assertEq(factory.pendingProtocolTreasury(), address(0));
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

    function testConstructorsRejectZeroOwners() public {
        vm.expectRevert(AssetRegistry.ZeroAddress.selector);
        new AssetRegistry(address(0));

        vm.expectRevert(RebalanceExecutor.ZeroAddress.selector);
        new RebalanceExecutor(address(0));
    }

    function testAssetRegistryRejectsEOAAssets() public {
        vm.expectPartialRevert(AssetRegistry.AssetNotContract.selector);
        assetRegistry.registerAsset(ALICE);
    }

    function testAssetRegistryRejectsNonEighteenDecimalConstituents() public {
        MockStockToken sixDecimalToken = new MockStockToken("Six Decimal", "SIX", 6);

        vm.expectPartialRevert(AssetRegistry.UnsupportedAssetDecimals.selector);
        assetRegistry.registerAsset(address(sixDecimalToken));

        assertFalse(assetRegistry.isRegisteredAsset(address(sixDecimalToken)));
    }

    function testFactoryRejectsNonContractDependencies() public {
        address implementation = factory.vaultImplementation();
        vm.expectPartialRevert(OTFFactory.InvalidDependency.selector);
        new OTFFactory(implementation, address(collector), address(assetRegistry), ALICE, 1_500);
    }
}
