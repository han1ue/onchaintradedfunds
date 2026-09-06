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
        (factory,, router) = _deployFactory();
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

    function testTickerLengthBoundariesAndLetterCaseAreAccepted() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        string[7] memory tickers = ["A", "z", "ABCDEFGH", "aBcDeFgH", "TECH1", "0", "12345678"];
        for (uint256 i = 0; i < tickers.length; i++) {
            params.symbol = tickers[i];
            vm.prank(CREATOR);
            ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
            assertEq(vault.symbol(), tickers[i]);
        }
    }

    function testInvalidTickersAreRejectedAtomically() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        string[16] memory tickers = [
            "",
            "ABCDEFGHI",
            "A B",
            " A",
            "A ",
            "A\n",
            "A\t",
            "\x00",
            "\x1f",
            "\x7f",
            unicode"é",
            unicode"🚀",
            "A-B",
            "$BTC",
            "@",
            "["
        ];
        for (uint256 i = 0; i < tickers.length; i++) {
            params.symbol = tickers[i];
            vm.prank(CREATOR);
            vm.expectRevert(ManagedOTFVaultStorage.InvalidVaultMetadata.selector);
            factory.createVault(params);
        }
        assertEq(factory.vaultCount(), 0);
    }

    function testNameRequiresLetterOrDigitBeforeExactSuffix() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        string[12] memory names = [
            "",
            "OTF",
            " OTF",
            "  OTF",
            "! OTF",
            "\t OTF",
            unicode"é OTF",
            unicode"🚀 OTF",
            "Alpha",
            "AlphaOTF",
            "Alpha otf",
            "Alpha OTF "
        ];
        for (uint256 i = 0; i < names.length; i++) {
            params.name = names[i];
            vm.prank(CREATOR);
            vm.expectRevert(ManagedOTFVaultStorage.InvalidVaultMetadata.selector);
            factory.createVault(params);
        }
        assertEq(factory.vaultCount(), 0);
    }

    function testValidNamesAreStoredExactly() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        string[6] memory names =
            ["A OTF", "z OTF", "123 Growth! OTF", unicode"Café 🚀 OTF", "123 OTF", "0 OTF"];
        for (uint256 i = 0; i < names.length; i++) {
            params.name = names[i];
            vm.prank(CREATOR);
            ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
            assertEq(vault.name(), names[i]);
        }
    }

    function testNameLimitCountsFullUtf8BytesIncludingSuffix() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        bytes memory prefix = new bytes(46);
        for (uint256 i = 0; i < prefix.length; i++) {
            prefix[i] = "A";
        }
        for (uint256 i = 0; i < 2; i++) {
            if (i == 1) {
                // Replace the final two ASCII letters with the UTF-8 bytes of é.
                prefix[44] = 0xc3;
                prefix[45] = 0xa9;
            }
            params.name = string.concat(string(prefix), " OTF");
            assertEq(bytes(params.name).length, 50);
            vm.prank(CREATOR);
            ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
            assertEq(vault.name(), params.name);

            params.name = string.concat("A", params.name);
            assertEq(bytes(params.name).length, 51);
            vm.prank(CREATOR);
            vm.expectRevert(ManagedOTFVaultStorage.InvalidVaultMetadata.selector);
            factory.createVault(params);
        }
        assertEq(factory.vaultCount(), 2);
    }

    function testEveryDigitIsAcceptedInTickerAndName() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        for (uint256 code = 0x30; code <= 0x39; code++) {
            params.symbol = string(abi.encodePacked(bytes1(uint8(code))));
            params.name = string.concat(params.symbol, " OTF");
            vm.prank(CREATOR);
            ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
            assertEq(vault.symbol(), params.symbol);
            assertEq(vault.name(), params.name);
        }
    }

    function testFundThesisAtByteLimitIsAccepted() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        bytes memory thesis = new bytes(2_048);
        for (uint256 i = 0; i < thesis.length; i++) {
            thesis[i] = "A";
        }
        params.fundThesis = string(thesis);
        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        assertEq(vault.fundThesis(), params.fundThesis);
    }

    function testEmptyFundThesisIsRejected() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        params.fundThesis = "";

        vm.prank(CREATOR);
        vm.expectRevert(ManagedOTFVaultStorage.FundThesisRequired.selector);
        factory.createVault(params);
    }

    function testFundThesisOverByteLimitIsRejected() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        params.fundThesis = string(new bytes(2_049));

        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.FundThesisTooLong.selector);
        factory.createVault(params);
    }

    function testCreationStoresExactFundThesis() public {
        VaultCreationParams memory params = _creationParams(_assets(), _units(3, 5), 0);
        params.fundThesis = unicode"Permanent tokenized infrastructure exposure — café 🚀";

        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.fundThesis(), params.fundThesis);
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

    function testCreationRequiresAtLeastTwoConstituents() public {
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint256[] memory units = new uint256[](1);
        units[0] = 1;

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(ManagedOTFVaultStorage.InvalidArrayLength.selector, 2, 1)
        );
        factory.createVault(_creationParams(assets, units, 0));
        assertEq(factory.vaultCount(), 0);
    }

    function testFirstMintMinimumUsesWadDenominatorAndCeilingRounding() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 300, 500, 0);

        vm.expectPartialRevert(ManagedOTFVaultStorage.BootstrapSharesTooSmall.selector);
        vault.previewMint(1e16 - 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BootstrapSharesTooSmall.selector);
        router.mint(vault, 1e16 - 1, ALICE, _zeroes(2));

        uint256[] memory minimum = vault.previewMint(1e16);
        assertEq(minimum[0], 3);
        assertEq(minimum[1], 5);

        uint256[] memory oneOtf = vault.previewMint(WAD);
        assertEq(oneOtf[0], 300);
        assertEq(oneOtf[1], 500);

        uint256[] memory deposited = _bootstrap(vault, router, _assets(), 1e16);
        assertEq(deposited[0], 3);
        assertEq(deposited[1], 5);
        assertEq(vault.totalSupply(), 1e16);
        assertEq(vault.accountedBalance(address(tokenA)), 3);
        assertEq(vault.accountedBalance(address(tokenB)), 5);

        uint256[] memory fractional = vault.previewMint(2.5e18);
        assertEq(fractional[0], 750);
        assertEq(fractional[1], 1_250);
    }

    function testFirstDepositorHasNoMaximumPurchaseSize() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 7, 11, 0);
        address[] memory assets = _assets();

        uint256[] memory amounts = _bootstrap(vault, router, assets, 25 * WAD);

        assertEq(amounts[0], 175);
        assertEq(amounts[1], 275);
        assertEq(vault.totalSupply(), 25 * WAD);
        assertEq(vault.balanceOf(ALICE), 25 * WAD);
        assertEq(vault.accountedBalance(address(tokenA)), 175);
        assertEq(vault.accountedBalance(address(tokenB)), 275);
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

    function testSpecialMinimumDoesNotApplyAfterBootstrap() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 7, 11, 0);
        address[] memory assets = _assets();
        _bootstrap(vault, router, assets, WAD);

        uint256[] memory amounts = vault.previewMint(1);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, 1, BOB, amounts);

        assertEq(vault.balanceOf(BOB), 1);
        assertEq(vault.totalSupply(), WAD + 1);
    }

    function testFullRedemptionEmptiesAccountingAndPermanentlyDisablesRebootstrap() public {
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
        assertTrue(vault.shutdown());

        uint256[] memory rebootstrap = vault.previewMint(WAD);
        assertEq(rebootstrap[0], 7);
        assertEq(rebootstrap[1], 11);
        tokenA.mint(address(router), rebootstrap[0]);
        tokenB.mint(address(router), rebootstrap[1]);
        router.approveAsset(address(tokenA), address(vault), rebootstrap[0]);
        router.approveAsset(address(tokenB), address(vault), rebootstrap[1]);
        vm.expectPartialRevert(ManagedOTFVaultStorage.VaultShutdown.selector);
        router.mint(vault, WAD, ALICE, rebootstrap);
        assertEq(vault.totalSupply(), 0);
    }

    function testPreviewMaxMintEnforcesBootstrapFloorAndSupportsFractionalScaling() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), 300, 500, 0);
        uint256[] memory maxima = _units(2, 4);
        (uint256 tooSmall,) = vault.previewMaxMint(maxima);
        assertEq(tooSmall, 0);

        maxima = _units(3, 5);
        (uint256 minimumShares, uint256[] memory minimumRequired) = vault.previewMaxMint(maxima);
        assertEq(minimumShares, 1e16);
        assertEq(minimumRequired[0], 3);
        assertEq(minimumRequired[1], 5);

        maxima = _units(7, 12);
        (uint256 shares, uint256[] memory required) = vault.previewMaxMint(maxima);
        assertEq(shares, 7 * WAD / 300);
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
