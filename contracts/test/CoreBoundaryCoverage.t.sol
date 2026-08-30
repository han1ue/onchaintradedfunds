// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { MockFeeOnTransferToken } from "./mocks/MockFeeOnTransferToken.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { BootstrapTestBase, MockCoreRouter } from "./BootstrapTestBase.sol";

contract CoreBoundaryCoverageTest is BootstrapTestBase {
    function testFeeCollectorClaimsAreTreasuryOnlyAndClaimAllDrainsCustody() public {
        FeeCollector collector = new FeeCollector(TREASURY);
        MockStockToken token = new MockStockToken("Custody", "CUST", 18);
        token.mint(address(collector), 200 * WAD);

        vm.prank(ALICE);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.claim(address(token), 50 * WAD);

        vm.prank(TREASURY);
        collector.claim(address(token), 50 * WAD);
        assertEq(token.balanceOf(TREASURY), 50 * WAD);
        assertEq(token.balanceOf(address(collector)), 150 * WAD);

        vm.prank(ALICE);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.claimAll(address(token));

        vm.prank(TREASURY);
        uint256 claimed = collector.claimAll(address(token));
        assertEq(claimed, 150 * WAD);
        assertEq(token.balanceOf(TREASURY), 200 * WAD);
        assertEq(token.balanceOf(address(collector)), 0);
    }

    function testFeeCollectorTreasuryTransferIsTwoStep() public {
        FeeCollector collector = new FeeCollector(TREASURY);
        MockStockToken token = new MockStockToken("Custody", "CUST", 18);
        token.mint(address(collector), WAD);

        vm.prank(ALICE);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.beginTreasuryTransfer(BOB);

        vm.prank(TREASURY);
        collector.beginTreasuryTransfer(BOB);
        assertEq(collector.treasury(), TREASURY);
        assertEq(collector.pendingTreasury(), BOB);

        vm.prank(ALICE);
        vm.expectRevert(FeeCollector.NotPendingTreasury.selector);
        collector.acceptTreasuryTransfer();

        vm.prank(BOB);
        collector.acceptTreasuryTransfer();
        assertEq(collector.treasury(), BOB);
        assertEq(collector.pendingTreasury(), address(0));

        vm.prank(TREASURY);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.claimAll(address(token));
        vm.prank(BOB);
        collector.claimAll(address(token));
        assertEq(token.balanceOf(BOB), WAD);
    }

    function testFeeCollectorRejectsInexactFeeOnTransferClaim() public {
        FeeCollector collector = new FeeCollector(TREASURY);
        MockFeeOnTransferToken taxed = new MockFeeOnTransferToken("Taxed", "TAX", 18);
        taxed.mint(address(collector), 100 * WAD);
        taxed.setFeeBps(100);

        vm.prank(TREASURY);
        vm.expectPartialRevert(FeeCollector.TokenTransferMismatch.selector);
        collector.claimAll(address(taxed));
        assertEq(taxed.balanceOf(address(collector)), 100 * WAD);
        assertEq(taxed.balanceOf(TREASURY), 0);
    }

    function testCreatorAndTreasuryRedeemAllAccruedFeeSharesProRata() public {
        (OTFFactory factory, FeeCollector collector, MockCoreRouter router) = _deployFactory(4_000);
        MockStockToken tokenA = new MockStockToken("Asset A", "A", 18);
        MockStockToken tokenB = new MockStockToken("Asset B", "B", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), WAD, WAD, 1_000);
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        _bootstrap(vault, router, assets, 100 * WAD);
        uint256 initialAccountedA = vault.accountedBalance(address(tokenA));
        uint256 initialAccountedB = vault.accountedBalance(address(tokenB));

        vm.warp(block.timestamp + 365 days);
        vault.checkpointFees();
        uint256 beneficiaryShares = vault.balanceOf(BENEFICIARY);
        uint256 protocolShares = vault.balanceOf(address(collector));
        assertGt(beneficiaryShares, 0);
        assertGt(protocolShares, 0);
        uint256 supplyBeforeBeneficiary = vault.totalSupply();
        uint256[] memory beneficiaryOut = vault.previewRedeem(beneficiaryShares);
        assertEq(beneficiaryOut[0], initialAccountedA * beneficiaryShares / supplyBeforeBeneficiary);
        assertEq(beneficiaryOut[1], initialAccountedB * beneficiaryShares / supplyBeforeBeneficiary);

        vm.prank(BENEFICIARY);
        vault.approve(address(router), beneficiaryShares);
        router.redeem(vault, beneficiaryShares, BENEFICIARY, BENEFICIARY, new uint256[](2));
        assertEq(tokenA.balanceOf(BENEFICIARY), beneficiaryOut[0]);
        assertEq(tokenB.balanceOf(BENEFICIARY), beneficiaryOut[1]);
        assertEq(vault.accountedBalance(address(tokenA)), initialAccountedA - beneficiaryOut[0]);
        assertEq(vault.accountedBalance(address(tokenB)), initialAccountedB - beneficiaryOut[1]);
        assertEq(tokenA.balanceOf(address(vault)), vault.accountedBalance(address(tokenA)));
        assertEq(tokenB.balanceOf(address(vault)), vault.accountedBalance(address(tokenB)));

        vm.prank(TREASURY);
        uint256 claimedShares = collector.claimAll(address(vault));
        assertEq(claimedShares, protocolShares);
        assertEq(vault.balanceOf(TREASURY), protocolShares);
        uint256 accountedBeforeTreasuryA = vault.accountedBalance(address(tokenA));
        uint256 accountedBeforeTreasuryB = vault.accountedBalance(address(tokenB));
        uint256 supplyBeforeTreasury = vault.totalSupply();
        uint256[] memory treasuryOut = vault.previewRedeem(protocolShares);
        assertEq(treasuryOut[0], accountedBeforeTreasuryA * protocolShares / supplyBeforeTreasury);
        assertEq(treasuryOut[1], accountedBeforeTreasuryB * protocolShares / supplyBeforeTreasury);

        vm.prank(TREASURY);
        vault.approve(address(router), protocolShares);
        router.redeem(vault, protocolShares, TREASURY, TREASURY, new uint256[](2));
        assertEq(tokenA.balanceOf(TREASURY), treasuryOut[0]);
        assertEq(tokenB.balanceOf(TREASURY), treasuryOut[1]);
        assertEq(vault.accountedBalance(address(tokenA)), accountedBeforeTreasuryA - treasuryOut[0]);
        assertEq(vault.accountedBalance(address(tokenB)), accountedBeforeTreasuryB - treasuryOut[1]);
        assertEq(tokenA.balanceOf(address(vault)), vault.accountedBalance(address(tokenA)));
        assertEq(tokenB.balanceOf(address(vault)), vault.accountedBalance(address(tokenB)));
        assertEq(vault.accountedBalance(address(tokenA)), vault.accountedBalance(address(tokenB)));
        assertApproxEqAbs(vault.accountedBalance(address(tokenA)), 90 * WAD, 2);
        assertEq(vault.totalSupply(), 100 * WAD);
    }

    function testCreationBoundsAndRouterConfigurationBoundaries() public {
        ManagedOTFVault implementation = new ManagedOTFVault();
        FeeCollector collector = new FeeCollector(TREASURY);
        OTFFactory unconfigured = new OTFFactory(address(implementation), address(collector), 0);
        OTFFactory otherFactory = new OTFFactory(address(implementation), address(collector), 0);
        MockCoreRouter wrongRouter = new MockCoreRouter(address(otherFactory));
        vm.expectPartialRevert(OTFFactory.RouterFactoryMismatch.selector);
        unconfigured.configureEntryExitRouter(address(wrongRouter));

        MockCoreRouter router = new MockCoreRouter(address(unconfigured));
        unconfigured.configureEntryExitRouter(address(router));
        vm.expectRevert(OTFFactory.RouterAlreadyConfigured.selector);
        unconfigured.configureEntryExitRouter(address(router));

        MockStockToken tokenA = new MockStockToken("Asset A", "A", 18);
        MockStockToken tokenB = new MockStockToken("Asset B", "B", 18);
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory units = new uint256[](2);
        units[0] = WAD;
        units[1] = WAD;
        VaultCreationParams memory invalidRatio = _creationParams(assets, units, 1_001);
        vm.prank(CREATOR);
        vm.expectPartialRevert(OTFFactory.ExpenseRatioTooHigh.selector);
        unconfigured.createVault(invalidRatio);

        VaultCreationParams memory zeroBeneficiary = _creationParams(assets, units, 0);
        zeroBeneficiary.expenseBeneficiary = address(0);
        vm.prank(CREATOR);
        vm.expectRevert(OTFFactory.InvalidVaultMetadata.selector);
        unconfigured.createVault(zeroBeneficiary);
    }
}
