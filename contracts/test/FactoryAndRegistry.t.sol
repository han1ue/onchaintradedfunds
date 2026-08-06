// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetRegistry } from "../src/AssetRegistry.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { OracleRegistry } from "../src/OracleRegistry.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract FactoryAndRegistryTest is ProtocolTestBase {
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
        params.creatorFeeBpsPerYear = 1_001;

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
        assertEq(factory.MAX_ORACLE_STALENESS(), 1 hours);

        VaultInitParams memory params = _defaultParams();
        params.maxNavLossBps = 201;
        vm.expectRevert(OTFFactory.LimitTooHigh.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.maxWeightDeviationBps = 1_001;
        vm.expectRevert(OTFFactory.LimitTooHigh.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.maxOracleStaleness = factory.MAX_ORACLE_STALENESS() + 1;
        vm.expectRevert(OTFFactory.LimitTooHigh.selector);
        factory.createVault(params);
    }

    function testFactoryRejectsInvalidZeroLimits() public {
        VaultInitParams memory params = _defaultParams();
        params.maxOracleStaleness = 0;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
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

    function testFactoryAllowsSingleAssetPortfolio() public {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](1);
        params.initialAssets[0] = address(tokenA);
        params.initialTargetWeightsBps = new uint16[](1);
        params.initialTargetWeightsBps[0] = 10_000;
        params.initialAmounts = new uint256[](1);
        params.initialAmounts[0] = 1_000 * ONE;

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.assetCount(), 1);
        assertEq(vault.targetWeightBps(address(tokenA)), 10_000);
    }

    function testFactoryRejectsInvalidChallengeConfiguration() public {
        assertEq(factory.MIN_CHALLENGE_GRACE_PERIOD(), 5 days);

        VaultInitParams memory params = _defaultParams();
        params.challengeWeightDeviationBps = params.maxWeightDeviationBps;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeWeightDeviationBps = 2_501;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeGracePeriod = 5 days - 1;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);

        params = _defaultParams();
        params.challengeGracePeriod = 30 days + 1;
        vm.expectRevert(OTFFactory.InvalidLimit.selector);
        factory.createVault(params);
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

    function testOnlyOwnerCanApproveAssetsAndAdapters() public {
        vm.prank(ATTACKER);
        vm.expectRevert(AssetRegistry.NotOwner.selector);
        assetRegistry.setAssetApproved(address(tokenA), false);

        vm.prank(ATTACKER);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setTradeAdapterApproved(address(adapter), false);

        assetRegistry.setAssetApproved(address(tokenA), false);
        factory.setTradeAdapterApproved(address(adapter), false);
        assertFalse(assetRegistry.isApprovedAsset(address(tokenA)));
        assertFalse(factory.isTradeAdapterApproved(address(adapter)));
    }

    function testRegistryOwnershipTransfersAreEnforced() public {
        assetRegistry.beginOwnershipTransfer(ALICE);
        oracleRegistry.beginOwnershipTransfer(ALICE);

        vm.prank(BOB);
        vm.expectRevert(AssetRegistry.NotPendingOwner.selector);
        assetRegistry.acceptOwnershipTransfer();
        vm.prank(BOB);
        vm.expectRevert(OracleRegistry.NotPendingOwner.selector);
        oracleRegistry.acceptOwnershipTransfer();

        vm.startPrank(ALICE);
        assetRegistry.acceptOwnershipTransfer();
        oracleRegistry.acceptOwnershipTransfer();
        vm.stopPrank();

        vm.expectRevert(AssetRegistry.NotOwner.selector);
        assetRegistry.setAssetApproved(address(tokenA), false);
        vm.expectRevert(OracleRegistry.NotOwner.selector);
        oracleRegistry.setPriceFeed(address(tokenA), address(feedB));

        vm.startPrank(ALICE);
        assetRegistry.setAssetApproved(address(tokenA), false);
        oracleRegistry.setPriceFeed(address(tokenA), address(feedB));
        vm.stopPrank();

        assertFalse(assetRegistry.isApprovedAsset(address(tokenA)));
        assertEq(oracleRegistry.priceFeedFor(address(tokenA)), address(feedB));
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

        vm.expectRevert(OracleRegistry.ZeroAddress.selector);
        new OracleRegistry(address(0));

        vm.expectRevert(RebalanceExecutor.ZeroAddress.selector);
        new RebalanceExecutor(address(0));
    }

    function testRegistriesRejectEOAAssetsAndFeeds() public {
        vm.expectPartialRevert(AssetRegistry.AssetNotContract.selector);
        assetRegistry.setAssetApproved(ALICE, true);

        vm.expectPartialRevert(OracleRegistry.AssetNotContract.selector);
        oracleRegistry.setPriceFeed(ALICE, address(feedA));

        vm.expectPartialRevert(OracleRegistry.FeedNotContract.selector);
        oracleRegistry.setPriceFeed(address(tokenA), ALICE);
    }

    function testFactoryRejectsNonContractDependencies() public {
        address implementation = factory.vaultImplementation();
        vm.expectPartialRevert(OTFFactory.InvalidDependency.selector);
        new OTFFactory(
            implementation,
            ALICE,
            address(assetRegistry),
            address(oracleRegistry),
            address(executor),
            1_500
        );
    }
}
