// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { BootstrapTestBase, MockBuybackReceiver, MockCoreRouter } from "./BootstrapTestBase.sol";

contract MissingFactoryGetterCollector {
    function recordFeeShares(uint256, uint256) external { }
}

contract RevertingFactoryGetterCollector {
    function factory() external pure returns (address) {
        revert("NO_FACTORY");
    }
}

contract MalformedFactoryGetterCollector {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(31, 1)
        }
    }
}

contract CoreBoundaryCoverageTest is BootstrapTestBase {
    function testFeeBenefitCurveReferenceValuesAndDonationDoesNotCount() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory();
        MockStockToken protocolOtf = MockStockToken(factory.otfToken());
        MockStockToken asset = new MockStockToken("Asset", "ASSET", 18);

        ManagedOTFVault zero = _newOtfVault(factory, protocolOtf, asset, 1, router);
        assertEq(zero.feeCreatorShareBps(), 5_000);
        protocolOtf.mint(address(zero), 10_000_000 ether);
        assertEq(zero.feeCreatorShareBps(), 5_000);

        assertEq(
            _newOtfVault(factory, protocolOtf, asset, 1_000_000 ether, router).feeCreatorShareBps(),
            6_264
        );
        assertEq(
            _newOtfVault(factory, protocolOtf, asset, 2_500_000 ether, router).feeCreatorShareBps(),
            7_000
        );
        assertEq(
            _newOtfVault(factory, protocolOtf, asset, 5_000_000 ether, router).feeCreatorShareBps(),
            7_828
        );
        assertEq(
            _newOtfVault(factory, protocolOtf, asset, 10_000_000 ether, router)
                .feeCreatorShareBps(),
            9_000
        );
        assertEq(
            _newOtfVault(factory, protocolOtf, asset, 11_000_000 ether, router)
                .feeCreatorShareBps(),
            9_000
        );
    }

    function testImmutableMintAndRedeemFeesMatchPreviewsAndExecution() public {
        (OTFFactory factory, address collector, MockCoreRouter router) = _deployFactory();
        MockStockToken asset = new MockStockToken("Asset", "ASSET", 18);
        MockStockToken assetB = new MockStockToken("Asset B", "ASSET-B", 18);
        address[] memory assets = new address[](2);
        assets[0] = address(asset);
        assets[1] = address(assetB);
        uint256[] memory units = new uint256[](2);
        units[0] = WAD;
        units[1] = WAD;
        VaultCreationParams memory params = _creationParams(assets, units, 0);
        params.mintFeeBps = 200;
        params.redeemFeeBps = 100;
        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        uint256 grossShares;
        uint256 creatorMint;
        uint256 buybackMint;
        {
            uint256 mintFee;
            (grossShares, mintFee, creatorMint, buybackMint,) = vault.previewMintFee(100 ether);
            _bootstrap(vault, router, assets, 100 ether);
            assertEq(vault.totalSupply(), grossShares);
            assertEq(vault.balanceOf(ALICE), 100 ether);
            assertEq(vault.balanceOf(BENEFICIARY), 0);
            assertEq(vault.balanceOf(collector), creatorMint + buybackMint);
            assertEq(MockBuybackReceiver(collector).creatorFeeShares(address(vault)), creatorMint);
            assertEq(MockBuybackReceiver(collector).buybackFeeShares(address(vault)), buybackMint);
            assertEq(creatorMint + buybackMint, mintFee);
        }
        assertEq(vault.mintFeeBps(), 200);
        assertEq(vault.redeemFeeBps(), 100);

        _assertRedeemFeeCollection(
            vault, router, asset, collector, grossShares, creatorMint, buybackMint
        );
    }

    function testFeeSplitIsRecordedWhenChargedAndNotRecomputedAfterOtfBalanceChanges() public {
        (OTFFactory factory, address collector, MockCoreRouter router) = _deployFactory();
        MockStockToken protocolOtf = MockStockToken(factory.otfToken());
        MockStockToken asset = new MockStockToken("Asset", "ASSET", 18);
        address[] memory assets = new address[](2);
        assets[0] = address(protocolOtf);
        assets[1] = address(asset);
        uint256[] memory units = new uint256[](2);
        units[0] = 1_000_000 ether;
        units[1] = WAD;
        VaultCreationParams memory params = _creationParams(assets, units, 0);
        params.mintFeeBps = 200;
        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        (,,, uint256 firstBuyback, uint16 firstSplit) = vault.previewMintFee(WAD);
        (, uint256 firstFee, uint256 firstCreator,,) = vault.previewMintFee(WAD);
        assertEq(firstSplit, 5_000);
        _bootstrap(vault, router, assets, WAD);

        (,,, uint256 secondBuyback, uint16 secondSplit) = vault.previewMintFee(WAD);
        (, uint256 secondFee, uint256 secondCreator,,) = vault.previewMintFee(WAD);
        assertGt(secondSplit, firstSplit);
        uint256[] memory secondAmounts = vault.previewMint(WAD);
        protocolOtf.mint(address(router), secondAmounts[0]);
        asset.mint(address(router), secondAmounts[1]);
        router.approveAsset(address(protocolOtf), address(vault), secondAmounts[0]);
        router.approveAsset(address(asset), address(vault), secondAmounts[1]);
        router.mint(vault, WAD, BOB, secondAmounts);

        assertEq(firstCreator + firstBuyback, firstFee);
        assertEq(secondCreator + secondBuyback, secondFee);
        assertEq(
            MockBuybackReceiver(collector).creatorFeeShares(address(vault)),
            firstCreator + secondCreator
        );
        assertEq(
            MockBuybackReceiver(collector).buybackFeeShares(address(vault)),
            firstBuyback + secondBuyback
        );
        assertEq(vault.balanceOf(collector), firstFee + secondFee);
        assertEq(vault.balanceOf(BENEFICIARY), 0);
    }

    function testNormalInKindRedeemChargesFeeButShutdownRedeemIsFree() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory();
        MockStockToken asset = new MockStockToken("Asset", "ASSET", 18);
        MockStockToken assetB = new MockStockToken("Asset B", "ASSET-B", 18);
        address[] memory assets = new address[](2);
        assets[0] = address(asset);
        assets[1] = address(assetB);
        uint256[] memory units = new uint256[](2);
        units[0] = WAD;
        units[1] = WAD;
        VaultCreationParams memory params = _creationParams(assets, units, 0);
        params.redeemFeeBps = 100;
        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        _bootstrap(vault, router, assets, 100 ether);

        (, uint256 feeShares,,,) = vault.previewRedeemFee(10 ether);
        vm.prank(ALICE);
        vault.redeemInKind(10 ether, ALICE, new uint256[](2), 0);
        assertGt(feeShares, 0);

        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();
        uint256 supplyBefore = vault.totalSupply();
        uint256 balance = vault.balanceOf(ALICE);
        (uint256 shutdownRedeemed, uint256 shutdownFee,,,) = vault.previewRedeemFee(balance);
        assertEq(shutdownRedeemed, balance);
        assertEq(shutdownFee, 0);
        assertEq(vault.previewRedeem(balance, 0)[0], balance);
        vm.prank(ALICE);
        vault.redeemInKind(balance, ALICE, new uint256[](2), 0);
        assertEq(vault.totalSupply(), supplyBefore - balance);
    }

    function testCreationFeeCapsAndRouterConfigurationBoundaries() public {
        ManagedOTFVault implementation = new ManagedOTFVault();
        MockBuybackReceiver collector = new MockBuybackReceiver();
        MockStockToken protocolOtf = new MockStockToken("OTF", "OTF", 18);
        OTFFactory unconfigured =
            new OTFFactory(address(implementation), address(collector), address(protocolOtf));
        OTFFactory otherFactory =
            new OTFFactory(address(implementation), address(collector), address(protocolOtf));
        collector.configureFactory(address(unconfigured));
        MockCoreRouter wrongRouter = new MockCoreRouter(address(otherFactory));
        vm.expectPartialRevert(OTFFactory.RouterFactoryMismatch.selector);
        unconfigured.configureEntryExitRouter(address(wrongRouter));

        MockCoreRouter router = new MockCoreRouter(address(unconfigured));
        unconfigured.configureEntryExitRouter(address(router));
        vm.expectRevert(OTFFactory.RouterAlreadyConfigured.selector);
        unconfigured.configureEntryExitRouter(address(router));

        MockStockToken asset = new MockStockToken("Asset", "ASSET", 18);
        MockStockToken assetB = new MockStockToken("Asset B", "ASSET-B", 18);
        address[] memory assets = new address[](2);
        assets[0] = address(asset);
        assets[1] = address(assetB);
        uint256[] memory units = new uint256[](2);
        units[0] = WAD;
        units[1] = WAD;

        VaultCreationParams memory invalid = _creationParams(assets, units, 1_001);
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.ExpenseRatioTooHigh.selector);
        unconfigured.createVault(invalid);
        invalid = _creationParams(assets, units, 0);
        invalid.mintFeeBps = 201;
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.MintFeeTooHigh.selector);
        unconfigured.createVault(invalid);
        invalid = _creationParams(assets, units, 0);
        invalid.redeemFeeBps = 101;
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.RedeemFeeTooHigh.selector);
        unconfigured.createVault(invalid);
    }

    function testCollectorFactoryGetterFailuresAreInvalidDependencies() public {
        ManagedOTFVault implementation = new ManagedOTFVault();
        MockStockToken protocolOtf = new MockStockToken("OTF", "OTF", 18);

        _assertCollectorFactoryRejected(
            address(implementation),
            address(new MissingFactoryGetterCollector()),
            address(protocolOtf)
        );
        _assertCollectorFactoryRejected(
            address(implementation),
            address(new RevertingFactoryGetterCollector()),
            address(protocolOtf)
        );
        _assertCollectorFactoryRejected(
            address(implementation),
            address(new MalformedFactoryGetterCollector()),
            address(protocolOtf)
        );
    }

    function _newOtfVault(
        OTFFactory factory,
        MockStockToken protocolOtf,
        MockStockToken asset,
        uint256 otfUnits,
        MockCoreRouter router
    ) private returns (ManagedOTFVault vault) {
        address[] memory assets = new address[](2);
        assets[0] = address(protocolOtf);
        assets[1] = address(asset);
        uint256[] memory units = new uint256[](2);
        units[0] = otfUnits;
        units[1] = WAD;
        vault = _createVault(factory, assets, units, 0);
        if (otfUnits > 1) _bootstrap(vault, router, assets, WAD);
    }

    function _assertRedeemFeeCollection(
        ManagedOTFVault vault,
        MockCoreRouter router,
        MockStockToken asset,
        address collector,
        uint256 grossShares,
        uint256 creatorMint,
        uint256 buybackMint
    ) private {
        (uint256 redeemedShares, uint256 redeemFee, uint256 creatorRedeem, uint256 buybackRedeem,) =
            vault.previewRedeemFee(50 ether);
        uint256[] memory preview = vault.previewRedeem(50 ether, 0);
        vm.prank(ALICE);
        vault.approve(address(router), 50 ether);
        router.redeem(vault, 50 ether, ALICE, ALICE, preview);
        assertEq(asset.balanceOf(ALICE), preview[0]);
        assertEq(vault.balanceOf(ALICE), 50 ether);
        assertEq(vault.balanceOf(BENEFICIARY), 0);
        assertEq(
            vault.balanceOf(collector), creatorMint + buybackMint + creatorRedeem + buybackRedeem
        );
        assertEq(
            MockBuybackReceiver(collector).creatorFeeShares(address(vault)),
            creatorMint + creatorRedeem
        );
        assertEq(
            MockBuybackReceiver(collector).buybackFeeShares(address(vault)),
            buybackMint + buybackRedeem
        );
        assertEq(creatorRedeem + buybackRedeem, redeemFee);
        assertEq(vault.totalSupply(), grossShares - redeemedShares);
    }

    function _assertCollectorFactoryRejected(
        address implementation,
        address collector,
        address protocolOtf
    ) private {
        OTFFactory factory = new OTFFactory(implementation, collector, protocolOtf);
        MockCoreRouter router = new MockCoreRouter(address(factory));
        vm.expectRevert(abi.encodeWithSelector(OTFFactory.InvalidDependency.selector, collector));
        factory.configureEntryExitRouter(address(router));
        assertEq(factory.entryExitRouter(), address(0));
    }
}
