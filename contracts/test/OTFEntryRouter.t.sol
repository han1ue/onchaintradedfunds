// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import {
    EntrySwap,
    ExactInputEntrySwap,
    ExitSwap,
    OTFEntryRouter
} from "../src/OTFEntryRouter.sol";
import { ITradeAdapter } from "../src/interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { MockEntryAdapter } from "../src/mocks/MockEntryAdapter.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract MinimumIgnoringTradeAdapter is ITradeAdapter {
    using SafeTransferLib for address;

    function executeSwap(address, address tokenOut, uint256 amountIn, uint256, bytes calldata)
        external
        returns (uint256 amountOut)
    {
        amountOut = amountIn / 2;
        tokenOut.safeTransfer(msg.sender, amountOut);
    }
}

contract OTFEntryRouterTest is ProtocolTestBase {
    OTFEntryRouter private entryRouter;
    MockEntryAdapter private entryAdapter;
    MockTradeAdapter private exitAdapter;

    function setUp() public override {
        super.setUp();
        entryRouter = new OTFEntryRouter(address(this), address(factory), address(tokenC));
        entryAdapter = new MockEntryAdapter();
        exitAdapter = new MockTradeAdapter();
        entryRouter.setEntryAdapterApproved(address(entryAdapter), true);
        entryRouter.setEntryAdapterApproved(address(exitAdapter), true);
        entryAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        entryAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(entryAdapter), 10_000 * ONE);
        tokenB.mint(address(entryAdapter), 10_000 * ONE);
        tokenC.mint(ALICE, 10_000 * ONE);
        exitAdapter.setRate(address(tokenA), address(tokenC), 1, 1);
        exitAdapter.setRate(address(tokenB), address(tokenC), 1, 1);
        tokenC.mint(address(exitAdapter), 10_000 * ONE);
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

    function testEntryCanMixApprovedAdaptersAcrossConstituentLegs() public {
        ManagedOTFVault vault = _createVault();
        MockEntryAdapter secondAdapter = new MockEntryAdapter();
        entryRouter.setEntryAdapterApproved(address(secondAdapter), true);
        secondAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenB.mint(address(secondAdapter), 10_000 * ONE);

        uint256 shares = 10 * ONE;
        uint256[] memory required = vault.previewMint(shares);
        EntrySwap[] memory swaps = _swaps(required[0], required[1]);
        swaps[1].adapter = address(secondAdapter);
        uint256 maximum = required[0] + required[1];

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), maximum);
        uint256 spent = entryRouter.enterWithSettlement(
            address(vault), shares, ALICE, maximum, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(spent, maximum);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenC.allowance(address(entryRouter), address(entryAdapter)), 0);
        assertEq(tokenC.allowance(address(entryRouter), address(secondAdapter)), 0);
    }

    function testUserCanSpendExactSettlementAndMintLargestProportionalBasket() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);

        ExactInputEntrySwap[] memory swaps = _exactInputSwaps(60 * ONE, 40 * ONE);
        uint256[] memory available = new uint256[](2);
        available[0] = 60 * ONE;
        available[1] = 40 * ONE;
        uint256 expectedShares = 8 * ONE;
        uint256[] memory required = vault.previewMint(expectedShares);
        assertEq(expectedShares, 8 * ONE);
        assertEq(required[0], 40 * ONE);
        assertEq(required[1], 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        (uint256 shares, uint256 settlementRefunded) = entryRouter.enterWithExactSettlement(
            address(vault), 100 * ONE, expectedShares, ALICE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(shares, expectedShares);
        assertEq(vault.balanceOf(ALICE), expectedShares);
        assertEq(settlementRefunded, 20 * ONE);
        assertEq(tokenA.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 9_920 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 540 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 540 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testExactSettlementEntryRefundSwapEnforcesMinimumRateAtomically() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        exitAdapter.setRate(address(tokenA), address(tokenC), 1, 2);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        ExactInputEntrySwap[] memory swaps = _exactInputSwaps(60 * ONE, 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(MockTradeAdapter.Slippage.selector, 10 * ONE, 20 * ONE)
        );
        entryRouter.enterWithExactSettlement(
            address(vault), 100 * ONE, 8 * ONE, ALICE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testExactSettlementEntryRevertsBelowMinimumSharesAtomically() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        ExactInputEntrySwap[] memory swaps = _exactInputSwaps(60 * ONE, 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryRouter.MinimumOutputNotMet.selector, 9 * ONE, 8 * ONE)
        );
        entryRouter.enterWithExactSettlement(
            address(vault), 100 * ONE, 9 * ONE, ALICE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testExactSettlementEntryUsesFeeAdjustedProportionalSupply() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        ExactInputEntrySwap[] memory swaps = _exactInputSwaps(50 * ONE, 50 * ONE);
        vm.warp(START + 365 days);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        (uint256 shares,) = entryRouter.enterWithExactSettlement(
            address(vault), 100 * ONE, 10 * ONE, ALICE, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertGt(shares, 10 * ONE);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenA.balanceOf(address(vault)), 550 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 550 * ONE);
    }

    function testExactSettlementEntryRequiresFullyAllocatedInput() public {
        ManagedOTFVault vault = _createVault();
        ExactInputEntrySwap[] memory swaps = _exactInputSwaps(50 * ONE, 40 * ONE);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryRouter.SettlementInputMismatch.selector, 100 * ONE, 90 * ONE
            )
        );
        entryRouter.enterWithExactSettlement(
            address(vault), 100 * ONE, ONE, ALICE, block.timestamp + 1 hours, swaps
        );
    }

    function testUnapprovedAdapterRevertsBeforePullingSettlement() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _swaps(60 * ONE, 60 * ONE);
        entryRouter.setEntryAdapterApproved(address(entryAdapter), false);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 120 * ONE);
        vm.expectPartialRevert(OTFEntryRouter.UnapprovedEntryAdapter.selector);
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
        vm.expectPartialRevert(MockEntryAdapter.MaximumInputExceeded.selector);
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
        vm.expectPartialRevert(OTFEntryRouter.DeadlineExpired.selector);
        entryRouter.enterWithSettlement(
            address(vault), 10 * ONE, ALICE, 120 * ONE, block.timestamp - 1, swaps
        );

        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryRouter.InvalidVault.selector);
        entryRouter.enterWithSettlement(
            address(entryAdapter), 10 * ONE, ALICE, 120 * ONE, block.timestamp + 1 hours, swaps
        );
    }

    function testOnlyOwnerCanApproveEntryAdapters() public {
        vm.prank(ATTACKER);
        vm.expectRevert(OTFEntryRouter.NotOwner.selector);
        entryRouter.setEntryAdapterApproved(address(entryAdapter), false);
    }

    function testEntryAdapterCanBeRevokedAfterItsCodeDisappears() public {
        address retiredAdapter = address(entryAdapter);
        assertTrue(entryRouter.isEntryAdapterApproved(retiredAdapter));

        vm.etch(retiredAdapter, bytes(""));
        entryRouter.setEntryAdapterApproved(retiredAdapter, false);
        assertFalse(entryRouter.isEntryAdapterApproved(retiredAdapter));

        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryRouter.InvalidDependency.selector, retiredAdapter)
        );
        entryRouter.setEntryAdapterApproved(retiredAdapter, true);

        MockEntryAdapter replacement = new MockEntryAdapter();
        entryRouter.setEntryAdapterApproved(address(replacement), true);
        assertTrue(entryRouter.isEntryAdapterApproved(address(replacement)));
    }

    function testUserCanRedeemBasketToSettlementTokenAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        uint256 expectedSettlement = expectedAssets[0] + expectedAssets[1];
        ExitSwap[] memory swaps = _exitSwaps(expectedAssets[0], expectedAssets[1]);

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        uint256 received = entryRouter.redeemToSettlement(
            address(vault), shares, ALICE, expectedSettlement, block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(received, expectedSettlement);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE + expectedSettlement);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
        assertEq(vault.allowance(ALICE, address(entryRouter)), 0);
    }

    function testSettlementExitMinimumAndAdapterApprovalRevertAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        ExitSwap[] memory swaps = _exitSwaps(0, 0);

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        vm.expectPartialRevert(OTFEntryRouter.MinimumOutputNotMet.selector);
        entryRouter.redeemToSettlement(
            address(vault),
            shares,
            ALICE,
            expectedAssets[0] + expectedAssets[1] + 1,
            block.timestamp + 1 hours,
            swaps
        );
        vm.stopPrank();
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);

        entryRouter.setEntryAdapterApproved(address(exitAdapter), false);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryRouter.UnapprovedEntryAdapter.selector);
        entryRouter.redeemToSettlement(
            address(vault), shares, ALICE, 1, block.timestamp + 1 hours, swaps
        );
        assertEq(vault.balanceOf(ALICE), shares);
    }

    function testSettlementExitEnforcesEachObservedLegMinimum() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);

        MinimumIgnoringTradeAdapter minimumIgnoringAdapter = new MinimumIgnoringTradeAdapter();
        entryRouter.setEntryAdapterApproved(address(minimumIgnoringAdapter), true);
        tokenC.mint(address(minimumIgnoringAdapter), expectedAssets[0]);
        exitAdapter.setRate(address(tokenB), address(tokenC), 2, 1);

        ExitSwap[] memory swaps = _exitSwaps(expectedAssets[0], expectedAssets[1]);
        swaps[0].adapter = address(minimumIgnoringAdapter);
        uint256 observedFirstLeg = expectedAssets[0] / 2;

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryRouter.MinimumOutputNotMet.selector, expectedAssets[0], observedFirstLeg
            )
        );
        entryRouter.redeemToSettlement(
            address(vault),
            shares,
            ALICE,
            expectedAssets[0] + expectedAssets[1],
            block.timestamp + 1 hours,
            swaps
        );
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function _swaps(uint256 maxA, uint256 maxB) private view returns (EntrySwap[] memory swaps) {
        swaps = new EntrySwap[](2);
        swaps[0] =
            EntrySwap({ adapter: address(entryAdapter), maxSettlementIn: maxA, adapterData: "" });
        swaps[1] =
            EntrySwap({ adapter: address(entryAdapter), maxSettlementIn: maxB, adapterData: "" });
    }

    function _exitSwaps(uint256 minA, uint256 minB) private view returns (ExitSwap[] memory swaps) {
        swaps = new ExitSwap[](2);
        swaps[0] =
            ExitSwap({ adapter: address(exitAdapter), minSettlementOut: minA, adapterData: "" });
        swaps[1] =
            ExitSwap({ adapter: address(exitAdapter), minSettlementOut: minB, adapterData: "" });
    }

    function _exactInputSwaps(uint256 settlementA, uint256 settlementB)
        private
        view
        returns (ExactInputEntrySwap[] memory swaps)
    {
        swaps = new ExactInputEntrySwap[](2);
        swaps[0] = ExactInputEntrySwap({
            adapter: address(exitAdapter),
            settlementIn: settlementA,
            minAssetOut: 0,
            minRefundSettlementRate: ONE,
            adapterData: "",
            refundAdapterData: ""
        });
        swaps[1] = ExactInputEntrySwap({
            adapter: address(exitAdapter),
            settlementIn: settlementB,
            minAssetOut: 0,
            minRefundSettlementRate: ONE,
            adapterData: "",
            refundAdapterData: ""
        });
    }
}
