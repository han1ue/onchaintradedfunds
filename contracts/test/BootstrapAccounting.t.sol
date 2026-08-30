// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { BootstrapTestBase, MockCoreRouter } from "./BootstrapTestBase.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";

contract BootstrapAccountingTest is BootstrapTestBase {
    OTFFactory internal factory;
    MockCoreRouter internal router;
    MockStockToken internal tokenA;
    MockStockToken internal tokenB;

    function setUp() public {
        (factory,, router) = _deployFactory(1_500);
        tokenA = new MockStockToken("Token A", "A", 18);
        tokenB = new MockStockToken("Token B", "B", 6);
    }

    function testCreationStoresCreatorAndImmutableBootstrapUnitsWithoutDeposit() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 3e18, 500_000, 1_000);

        assertEq(vault.creator(), CREATOR);
        assertEq(vault.bootstrapBasketUnitsPerOTF(address(tokenA)), 3e18);
        assertEq(vault.bootstrapBasketUnitsPerOTF(address(tokenB)), 500_000);
        uint256[] memory units = vault.bootstrapBasketUnits();
        assertEq(units[0], 3e18);
        assertEq(units[1], 500_000);
        assertEq(vault.totalSupply(), 0);
        assertEq(tokenA.balanceOf(address(vault)), 0);
        assertEq(tokenB.balanceOf(address(vault)), 0);
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(vault));
        assertTrue(factory.isVault(address(vault)));
    }

    function testCloneAddressesAreNotDeterministicAndCreatorIsCaller() public {
        address[] memory assets = _assets();
        uint256[] memory units = _units(3, 5);
        VaultCreationParams memory params = _creationParams(assets, units, 0);

        vm.prank(ALICE);
        ManagedOTFVault first = ManagedOTFVault(factory.createVault(params));
        vm.prank(BOB);
        ManagedOTFVault second = ManagedOTFVault(factory.createVault(params));

        assertTrue(address(first) != address(second));
        assertEq(first.creator(), ALICE);
        assertEq(second.creator(), BOB);
    }

    function testInvalidBasketConfigurationRevertsAtomically() public {
        address[] memory assets = _assets();
        uint256[] memory units = new uint256[](1);
        units[0] = 1;
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidArrayLength.selector);
        factory.createVault(_creationParams(assets, units, 0));
        assertEq(factory.vaultCount(), 0);

        units = _units(1, 0);
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidBootstrapBasketUnit.selector);
        factory.createVault(_creationParams(assets, units, 0));
        assertEq(factory.vaultCount(), 0);

        assets[1] = assets[0];
        units[1] = 1;
        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.DuplicateConstituent.selector);
        factory.createVault(_creationParams(assets, units, 0));
        assertEq(factory.vaultCount(), 0);
    }

    function testFirstMintBelowAtAndAboveOneOTFUsesCeilingRounding() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 3, 5, 0);

        vm.expectPartialRevert(ManagedOTFVaultStorage.BootstrapSharesTooSmall.selector);
        vault.previewMint(WAD - 1);

        uint256[] memory oneOtf = vault.previewMint(WAD);
        assertEq(oneOtf[0], 3);
        assertEq(oneOtf[1], 5);

        uint256[] memory fractional = vault.previewMint(2.5e18);
        assertEq(fractional[0], 8);
        assertEq(fractional[1], 13);
    }

    function testFirstDepositorCanBootstrapMultipleOTFs() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 7, 11, 0);
        address[] memory assets = _assets();

        uint256[] memory amounts = _bootstrap(vault, router, assets, 4 * WAD);

        assertEq(amounts[0], 28);
        assertEq(amounts[1], 44);
        assertEq(vault.totalSupply(), 4 * WAD);
        assertEq(vault.balanceOf(ALICE), 4 * WAD);
        assertEq(vault.accountedBalance(address(tokenA)), 28);
        assertEq(vault.accountedBalance(address(tokenB)), 44);
    }

    function testLaterMintUsesCurrentAccountedBalancesAndSupply() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 7, 11, 0);
        address[] memory assets = _assets();
        _bootstrap(vault, router, assets, 2 * WAD);
        tokenA.mint(address(vault), 100);
        tokenB.mint(address(vault), 100);

        uint256[] memory next = vault.previewMint(WAD);

        assertEq(next[0], 7);
        assertEq(next[1], 11);
    }

    function testFullRedemptionEmptiesAccountingAndRebootstrapReusesImmutableUnits() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 7, 11, 0);
        address[] memory assets = _assets();
        _bootstrap(vault, router, assets, 2 * WAD);

        vm.prank(ALICE);
        vault.approve(address(router), 2 * WAD);
        router.redeem(vault, 2 * WAD, ALICE, ALICE, _zeroes(2));

        assertEq(vault.totalSupply(), 0);
        assertEq(vault.accountedBalance(address(tokenA)), 0);
        assertEq(vault.accountedBalance(address(tokenB)), 0);
        assertEq(tokenA.balanceOf(address(vault)), 0);
        assertEq(tokenB.balanceOf(address(vault)), 0);

        uint256[] memory rebootstrap = vault.previewMint(WAD);
        assertEq(rebootstrap[0], 7);
        assertEq(rebootstrap[1], 11);
        _bootstrap(vault, router, assets, WAD);
        assertEq(vault.totalSupply(), WAD);
    }

    function testPreviewMaxMintEnforcesBootstrapFloorAndSupportsFractionalScaling() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 3, 5, 0);
        uint256[] memory maxima = _units(2, 4);
        (uint256 tooSmall,) = vault.previewMaxMint(maxima);
        assertEq(tooSmall, 0);

        maxima = _units(7, 12);
        (uint256 shares, uint256[] memory required) = vault.previewMaxMint(maxima);
        assertEq(shares, 7 * WAD / 3);
        assertEq(required[0], 7);
        assertEq(required[1], 12);
    }

    function _assets() private view returns (address[] memory assets) {
        assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
    }

    function _units(uint256 first, uint256 second) private pure returns (uint256[] memory units) {
        units = new uint256[](2);
        units[0] = first;
        units[1] = second;
    }
}
