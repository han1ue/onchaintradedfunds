// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import {
    BootstrapTestBase,
    CrossMutatingToken,
    MockCoreRouter,
    SlashableToken
} from "./BootstrapTestBase.sol";
import { Vm } from "./TestBase.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";

interface IMintableConstituent {
    function mint(address to, uint256 amount) external;
}

contract ToggleFailingToken is ERC20 {
    error ExternalCallsDisabled();

    bool public externalCallsDisabled;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setExternalCallsDisabled(bool disabled) external {
        externalCallsDisabled = disabled;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (externalCallsDisabled) revert ExternalCallsDisabled();
        return super.balanceOf(account);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (externalCallsDisabled) revert ExternalCallsDisabled();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (externalCallsDisabled) revert ExternalCallsDisabled();
        return super.transferFrom(from, to, amount);
    }
}

contract VaultInKindRedemptionTest is BootstrapTestBase {
    OTFFactory internal factory;
    MockCoreRouter internal router;
    MockStockToken internal tokenA;
    MockStockToken internal tokenB;

    function setUp() public {
        (factory,, router) = _deployFactory();
        tokenA = new MockStockToken("Asset A", "A", 18);
        tokenB = new MockStockToken("Asset B", "B", 18);
    }

    function testRedeemInKindNeedsNoRouterApprovalOrSwapLiquidity() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), WAD, WAD, 0);
        _bootstrap(vault, router, _twoAssets(address(tokenA), address(tokenB)), 2 * WAD);

        vm.prank(ALICE);
        uint256[] memory amountsOut = vault.redeemInKind(WAD, BOB, _zeroes(2), 0);

        assertEq(amountsOut[0], WAD);
        assertEq(amountsOut[1], WAD);
        assertEq(tokenA.balanceOf(BOB), WAD);
        assertEq(tokenB.balanceOf(BOB), WAD);
        assertEq(vault.totalSupply(), WAD);
        assertEq(vault.accountedBalance(address(tokenA)), WAD);
        assertEq(vault.accountedBalance(address(tokenB)), WAD);
        assertFalse(vault.shutdown());
    }

    function testSkippedUnreadableConstituentIsNeverCalledAndForfeitureIsNotInherited() public {
        ToggleFailingToken failing = new ToggleFailingToken("Failing", "FAIL");
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(failing), address(tokenB), WAD, WAD, 0);
        _bootstrapMintable(vault, _twoAssets(address(failing), address(tokenB)), 2 * WAD);
        vm.prank(ALICE);
        vault.transfer(BOB, WAD);
        failing.setExternalCallsDisabled(true);

        vm.recordLogs();
        vm.prank(ALICE);
        uint256[] memory amountsOut = vault.redeemInKind(WAD, ALICE, _zeroes(2), 1);

        assertEq(amountsOut[0], 0);
        assertEq(amountsOut[1], WAD);
        assertEq(tokenB.balanceOf(ALICE), WAD);
        assertEq(vault.accountedBalance(address(failing)), WAD);
        assertEq(vault.accountedBalance(address(tokenB)), WAD);
        assertFalse(vault.shutdown());
        _assertInKindEvent(WAD, amountsOut, _values(WAD, 0), 1);

        failing.setExternalCallsDisabled(false);
        assertEq(failing.balanceOf(address(vault)), 2 * WAD);
        assertEq(failing.balanceOf(address(vault)) - vault.accountedBalance(address(failing)), WAD);

        vm.prank(BOB);
        uint256[] memory remainingOut = vault.redeemInKind(WAD, BOB, _zeroes(2), 0);
        assertEq(remainingOut[0], WAD);
        assertEq(remainingOut[1], WAD);
        assertEq(failing.balanceOf(BOB), WAD);
        assertEq(failing.balanceOf(address(vault)), WAD);
        assertEq(vault.accountedBalance(address(failing)), 0);
        assertEq(vault.accountedBalance(address(tokenB)), 0);
        assertEq(vault.totalSupply(), 0);
        assertTrue(vault.shutdown());
        assertEq(vault.shutdownAt(), block.timestamp);
    }

    function testMultipleSkippedConstituentsAreUntouchedWhileHealthyAssetPays() public {
        ToggleFailingToken first = new ToggleFailingToken("First", "FIRST");
        ToggleFailingToken last = new ToggleFailingToken("Last", "LAST");
        address[] memory assets = new address[](3);
        assets[0] = address(first);
        assets[1] = address(tokenB);
        assets[2] = address(last);
        uint256[] memory units = _threeValues(WAD, WAD, WAD);
        ManagedOTFVault vault = _createVault(factory, assets, units, 0);
        _bootstrapMintable(vault, assets, 2 * WAD);
        vm.prank(ALICE);
        vault.transfer(BOB, WAD);
        first.setExternalCallsDisabled(true);
        last.setExternalCallsDisabled(true);

        vm.prank(ALICE);
        uint256[] memory amountsOut = vault.redeemInKind(WAD, ALICE, _zeroes(3), 5);

        assertEq(amountsOut[0], 0);
        assertEq(amountsOut[1], WAD);
        assertEq(amountsOut[2], 0);
        assertEq(tokenB.balanceOf(ALICE), WAD);
        assertEq(vault.accountedBalance(address(first)), WAD);
        assertEq(vault.accountedBalance(address(last)), WAD);
        assertFalse(vault.shutdown());

        first.setExternalCallsDisabled(false);
        last.setExternalCallsDisabled(false);
        assertEq(first.balanceOf(address(vault)), 2 * WAD);
        assertEq(last.balanceOf(address(vault)), 2 * WAD);
    }

    function testSkipValidationRunsBeforeAnyConstituentCall() public {
        ToggleFailingToken failing = new ToggleFailingToken("Failing", "FAIL");
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(failing), WAD, WAD, 0);
        _bootstrapMintable(vault, _twoAssets(address(tokenA), address(failing)), WAD);
        failing.setExternalCallsDisabled(true);

        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidSkipMask.selector);
        vault.redeemInKind(WAD, ALICE, _zeroes(2), 4);

        uint256[] memory minimums = _values(0, 1);
        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.SkippedAssetMinimumNotZero.selector);
        vault.redeemInKind(WAD, ALICE, minimums, 2);

        assertEq(vault.balanceOf(ALICE), WAD);
        assertFalse(vault.shutdown());
    }

    function testRedeemInKindBurnsOnlyCallersShares() public {
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), WAD, WAD, 0);
        _bootstrap(vault, router, _twoAssets(address(tokenA), address(tokenB)), WAD);

        vm.prank(BOB);
        vm.expectRevert();
        vault.redeemInKind(1, BOB, _zeroes(2), 0);

        assertEq(vault.balanceOf(ALICE), WAD);
        assertEq(vault.totalSupply(), WAD);
    }

    function testRedeemInKindWorksDuringShutdownAndCapsDeficientPayout() public {
        SlashableToken deficient = new SlashableToken("Deficient", "DEF", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(deficient), address(tokenB), WAD, WAD, 0);
        _bootstrapMintable(vault, _twoAssets(address(deficient), address(tokenB)), 2 * WAD);
        vm.prank(ALICE);
        vault.transfer(BOB, WAD);
        deficient.slash(address(vault), WAD);
        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();

        vm.prank(ALICE);
        uint256[] memory amountsOut = vault.redeemInKind(WAD, ALICE, _zeroes(2), 0);

        assertEq(amountsOut[0], WAD / 2);
        assertEq(amountsOut[1], WAD);
        assertEq(vault.accountedBalance(address(deficient)), WAD);
        assertEq(vault.accountedBalance(address(tokenB)), WAD);
        assertTrue(vault.shutdown());
    }

    function testRedeemInKindFinalCheckRejectsCrossTokenMutation() public {
        SlashableToken first = new SlashableToken("First", "FIRST", 18);
        CrossMutatingToken last = new CrossMutatingToken("Last", "LAST", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(first), address(last), WAD, WAD, 0);
        _bootstrapMintable(vault, _twoAssets(address(first), address(last)), 2 * WAD);
        last.configureCallback(
            address(first), abi.encodeWithSelector(first.slash.selector, address(vault), 1), true
        );

        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BasketBalanceChanged.selector);
        vault.redeemInKind(WAD, ALICE, _zeroes(2), 0);

        assertEq(vault.balanceOf(ALICE), 2 * WAD);
        assertEq(first.balanceOf(address(vault)), 2 * WAD);
        assertEq(last.balanceOf(address(vault)), 2 * WAD);
    }

    function _bootstrapMintable(ManagedOTFVault vault, address[] memory assets, uint256 shares)
        private
    {
        uint256[] memory amounts = vault.previewMint(shares);
        for (uint256 i = 0; i < assets.length; i++) {
            IMintableConstituent(assets[i]).mint(address(router), amounts[i]);
            router.approveAsset(assets[i], address(vault), amounts[i]);
        }
        router.mint(vault, shares, ALICE, amounts);
    }

    function _assertInKindEvent(
        uint256 expectedShares,
        uint256[] memory expectedAmountsOut,
        uint256[] memory expectedForfeited,
        uint256 expectedSkipMask
    ) private {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 signature =
            keccak256("InKindRedeemed(address,address,uint256,uint256[],uint256[],uint256)");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(0) && entries[i].topics[0] == signature) {
                (
                    uint256 shares,
                    uint256[] memory amountsOut,
                    uint256[] memory forfeited,
                    uint256 mask
                ) = abi.decode(entries[i].data, (uint256, uint256[], uint256[], uint256));
                assertEq(shares, expectedShares);
                assertEq(amountsOut[0], expectedAmountsOut[0]);
                assertEq(amountsOut[1], expectedAmountsOut[1]);
                assertEq(forfeited[0], expectedForfeited[0]);
                assertEq(forfeited[1], expectedForfeited[1]);
                assertEq(mask, expectedSkipMask);
                return;
            }
        }
        revert("InKindRedeemed event missing");
    }

    function _twoAssets(address first, address second)
        private
        pure
        returns (address[] memory assets)
    {
        assets = new address[](2);
        assets[0] = first;
        assets[1] = second;
    }

    function _values(uint256 first, uint256 second) private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = first;
        values[1] = second;
    }

    function _threeValues(uint256 first, uint256 second, uint256 third)
        private
        pure
        returns (uint256[] memory values)
    {
        values = new uint256[](3);
        values[0] = first;
        values[1] = second;
        values[2] = third;
    }
}
