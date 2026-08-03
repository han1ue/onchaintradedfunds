// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { EntrySwap, OTFEntryRouter } from "../src/OTFEntryRouter.sol";
import { MockEntryAdapter } from "../src/mocks/MockEntryAdapter.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract OTFEntryRouterTest is ProtocolTestBase {
    OTFEntryRouter private entryRouter;
    MockEntryAdapter private entryAdapter;

    function setUp() public override {
        super.setUp();
        entryRouter = new OTFEntryRouter(address(this), address(factory), address(tokenC));
        entryAdapter = new MockEntryAdapter();
        entryRouter.setEntryAdapterApproved(address(entryAdapter), true);
        entryAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        entryAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(entryAdapter), 10_000 * ONE);
        tokenB.mint(address(entryAdapter), 10_000 * ONE);
        tokenC.mint(ALICE, 10_000 * ONE);
    }

    function testUserCanEnterWithOnlySettlementTokenAndReceiveExactShares() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory required = vault.previewMint(shares);
        EntrySwap[] memory swaps = _swaps(required[0] + 10 * ONE, required[1] + 10 * ONE);
        uint256 maximum = swaps[0].maxSettlementIn + swaps[1].maxSettlementIn;
        uint256 expectedSpend = required[0] + required[1];

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), maximum);
        uint256 spent = entryRouter.enterWithSettlement(
            address(vault), shares, ALICE, maximum, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(spent, expectedSpend);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE - expectedSpend);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.allowance(address(entryRouter), address(entryAdapter)), 0);
        assertEq(tokenA.allowance(address(entryRouter), address(vault)), 0);
        assertEq(tokenB.allowance(address(entryRouter), address(vault)), 0);
    }

    function testUnapprovedAdapterRevertsBeforePullingSettlement() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _swaps(60 * ONE, 60 * ONE);
        entryRouter.setEntryAdapterApproved(address(entryAdapter), false);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 120 * ONE);
        vm.expectRevert(OTFEntryRouter.UnapprovedEntryAdapter.selector);
        entryRouter.enterWithSettlement(
            address(vault), 10 * ONE, ALICE, 120 * ONE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
    }

    function testInsufficientPerAssetMaximumRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        entryAdapter.setRate(address(tokenC), address(tokenA), 2, 1);
        EntrySwap[] memory swaps = _swaps(60 * ONE, 60 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 120 * ONE);
        vm.expectRevert(MockEntryAdapter.MaximumInputExceeded.selector);
        entryRouter.enterWithSettlement(
            address(vault), 10 * ONE, ALICE, 120 * ONE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testExpiredEntryAndUnknownVaultRevert() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _swaps(60 * ONE, 60 * ONE);

        vm.prank(ALICE);
        vm.expectRevert(OTFEntryRouter.DeadlineExpired.selector);
        entryRouter.enterWithSettlement(
            address(vault), 10 * ONE, ALICE, 120 * ONE, block.timestamp - 1, swaps
        );

        vm.prank(ALICE);
        vm.expectRevert(OTFEntryRouter.InvalidVault.selector);
        entryRouter.enterWithSettlement(
            address(entryAdapter), 10 * ONE, ALICE, 120 * ONE, block.timestamp + 1 hours, swaps
        );
    }

    function testOnlyOwnerCanApproveEntryAdapters() public {
        vm.prank(ATTACKER);
        vm.expectRevert(OTFEntryRouter.NotOwner.selector);
        entryRouter.setEntryAdapterApproved(address(entryAdapter), false);
    }

    function _swaps(uint256 maxA, uint256 maxB)
        private
        view
        returns (EntrySwap[] memory swaps)
    {
        swaps = new EntrySwap[](2);
        swaps[0] = EntrySwap({
            adapter: address(entryAdapter), maxSettlementIn: maxA, adapterData: ""
        });
        swaps[1] = EntrySwap({
            adapter: address(entryAdapter), maxSettlementIn: maxB, adapterData: ""
        });
    }
}
