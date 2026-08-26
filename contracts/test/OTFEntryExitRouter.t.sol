// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { EntrySwap, ExitSwap, OTFEntryExitRouter } from "../src/OTFEntryExitRouter.sol";
import { ITradeAdapter } from "../src/interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { MockTradeAdapter } from "./mocks/MockTradeAdapter.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

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

contract OTFEntryExitRouterTest is ProtocolTestBase {
    OTFEntryExitRouter private entryRouter;
    MockTradeAdapter private exitAdapter;

    function setUp() public override {
        super.setUp();
        entryRouter = new OTFEntryExitRouter(address(this), address(factory));
        exitAdapter = new MockTradeAdapter();
        entryRouter.setTradeAdapterApproved(address(exitAdapter), true);
        tokenC.mint(ALICE, 10_000 * ONE);
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        exitAdapter.setRate(address(tokenA), address(tokenC), 1, 1);
        exitAdapter.setRate(address(tokenB), address(tokenC), 1, 1);
        tokenA.mint(address(exitAdapter), 10_000 * ONE);
        tokenB.mint(address(exitAdapter), 10_000 * ONE);
        tokenC.mint(address(exitAdapter), 10_000 * ONE);
    }

    function testUserCanSpendFixedSettlementAndMintLargestProportionalBasket() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);

        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);
        uint256 expectedShares = 8 * ONE;
        uint256[] memory required = vault.previewMint(expectedShares);
        assertEq(expectedShares, 8 * ONE);
        assertEq(required[0], 40 * ONE);
        assertEq(required[1], 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        (uint256 shares, uint256 inputRefunded) = entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, expectedShares, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(shares, expectedShares);
        assertEq(vault.balanceOf(ALICE), expectedShares);
        assertEq(inputRefunded, 20 * ONE);
        assertEq(tokenA.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 9_920 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 540 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 540 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testEntryAcceptsDifferentInputTokenAndSkipsDirectConstituentLeg() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenA), address(tokenB), 1, 1);
        exitAdapter.setRate(address(tokenB), address(tokenA), 1, 1);
        tokenA.mint(ALICE, 100 * ONE);

        EntrySwap[] memory swaps = new EntrySwap[](2);
        swaps[0] = EntrySwap({
            adapter: address(0),
            inputAmount: 50 * ONE,
            minAssetOut: 50 * ONE,
            minRefundInputRate: 0,
            adapterData: "",
            refundAdapterData: ""
        });
        swaps[1] = EntrySwap({
            adapter: address(exitAdapter),
            inputAmount: 50 * ONE,
            minAssetOut: 50 * ONE,
            minRefundInputRate: ONE,
            adapterData: "",
            refundAdapterData: ""
        });

        vm.startPrank(ALICE);
        tokenA.approve(address(entryRouter), 100 * ONE);
        (uint256 shares, uint256 inputRefunded) = entryRouter.enterWithToken(
            address(vault), address(tokenA), 100 * ONE, 10 * ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(shares, 10 * ONE);
        assertEq(inputRefunded, 0);
        assertEq(vault.balanceOf(ALICE), 10 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
    }

    function testFixedSettlementEntryRefundSwapEnforcesMinimumRateAtomically() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        exitAdapter.setRate(address(tokenA), address(tokenC), 1, 2);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(MockTradeAdapter.Slippage.selector, 10 * ONE, 20 * ONE)
        );
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, 8 * ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testFixedSettlementEntryRevertsBelowMinimumSharesAtomically() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.MinimumOutputNotMet.selector, 9 * ONE, 8 * ONE
            )
        );
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, 9 * ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testFixedSettlementEntryUsesFeeAdjustedProportionalSupply() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 1);
        exitAdapter.setRate(address(tokenC), address(tokenB), 1, 1);
        tokenA.mint(address(exitAdapter), 100 * ONE);
        tokenB.mint(address(exitAdapter), 100 * ONE);
        EntrySwap[] memory swaps = _entrySwaps(50 * ONE, 50 * ONE);
        vm.warp(START + 365 days);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        (uint256 shares,) = entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, 10 * ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertGt(shares, 10 * ONE);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenA.balanceOf(address(vault)), 550 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 550 * ONE);
    }

    function testFixedSettlementEntryProcessesOverdueTreasuryForfeiture() public {
        ManagedOTFVault vault = _createVault();
        feedA.setRoundData(2, 120_00000000, block.timestamp, block.timestamp, 2);
        vault.flagOutOfBand();
        vm.warp(vault.challengeDeadline() + 1);

        EntrySwap[] memory swaps = _entrySwaps(50 * ONE, 50 * ONE);
        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        (uint256 shares,) = entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(vault.balanceOf(ALICE), shares);
        assertGt(vault.balanceOf(address(collector)), 0);
    }

    function testFixedSettlementEntryRequiresFullyAllocatedInput() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _entrySwaps(50 * ONE, 40 * ONE);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.InputAmountMismatch.selector, 100 * ONE, 90 * ONE
            )
        );
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
    }

    function testUnapprovedAdapterRevertsBeforePullingSettlement() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);
        entryRouter.setTradeAdapterApproved(address(exitAdapter), false);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.UnapprovedTradeAdapter.selector);
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
    }

    function testVaultLocalPauseBlocksEntryBeforePullButKeepsSettlementExitOpen() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory entrySwaps = _entrySwaps(60 * ONE, 40 * ONE);
        factory.setVaultDepositsPaused(address(vault), true);

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.VaultDepositsPaused.selector, address(vault))
        );
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, entrySwaps
        );
        vm.stopPrank();
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);

        uint256 shares = ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        ExitSwap[] memory exitSwaps = _exitSwaps(expectedAssets[0], expectedAssets[1]);
        uint256 settlementBefore = tokenC.balanceOf(ALICE);
        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        uint256 received = entryRouter.redeemToToken(
            address(vault),
            address(tokenC),
            shares,
            ALICE,
            expectedAssets[0] + expectedAssets[1],
            block.timestamp + 1 hours,
            exitSwaps
        );
        vm.stopPrank();
        assertEq(tokenC.balanceOf(ALICE), settlementBefore + received);
        assertEq(vault.balanceOf(ALICE), 0);
    }

    function testSettlementEntryEnforcesPerAssetMinimumAtomically() public {
        ManagedOTFVault vault = _createVault();
        exitAdapter.setRate(address(tokenC), address(tokenA), 1, 2);
        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);
        swaps[0].minAssetOut = 60 * ONE;

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(MockTradeAdapter.Slippage.selector, 30 * ONE, 60 * ONE)
        );
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function testExpiredEntryAndUnknownVaultRevert() public {
        ManagedOTFVault vault = _createVault();
        EntrySwap[] memory swaps = _entrySwaps(60 * ONE, 40 * ONE);

        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.DeadlineExpired.selector);
        entryRouter.enterWithToken(
            address(vault), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp - 1, swaps
        );

        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.InvalidVault.selector);
        entryRouter.enterWithToken(
            address(exitAdapter), address(tokenC), 100 * ONE, ONE, ALICE,
            block.timestamp + 1 hours, swaps
        );
    }

    function testOnlyOwnerCanApproveTradeAdapters() public {
        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        entryRouter.setTradeAdapterApproved(address(exitAdapter), false);
    }

    function testRouterOwnershipTransferRequiresPendingOwnerAcceptance() public {
        entryRouter.transferOwnership(ALICE);

        assertEq(entryRouter.owner(), address(this));
        assertEq(entryRouter.pendingOwner(), ALICE);
        entryRouter.setTradeAdapterApproved(address(exitAdapter), false);

        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        entryRouter.acceptOwnership();

        vm.prank(ALICE);
        entryRouter.acceptOwnership();
        assertEq(entryRouter.owner(), ALICE);
        assertEq(entryRouter.pendingOwner(), address(0));

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this))
        );
        entryRouter.setTradeAdapterApproved(address(exitAdapter), true);
    }

    function testTradeAdapterCanBeRevokedAfterItsCodeDisappears() public {
        address retiredAdapter = address(exitAdapter);
        assertTrue(entryRouter.isTradeAdapterApproved(retiredAdapter));

        vm.etch(retiredAdapter, bytes(""));
        entryRouter.setTradeAdapterApproved(retiredAdapter, false);
        assertFalse(entryRouter.isTradeAdapterApproved(retiredAdapter));

        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.InvalidDependency.selector, retiredAdapter)
        );
        entryRouter.setTradeAdapterApproved(retiredAdapter, true);

        MockTradeAdapter replacement = new MockTradeAdapter();
        entryRouter.setTradeAdapterApproved(address(replacement), true);
        assertTrue(entryRouter.isTradeAdapterApproved(address(replacement)));
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
        uint256 received = entryRouter.redeemToToken(
            address(vault), address(tokenC), shares, ALICE, expectedSettlement,
            block.timestamp + 1 hours, swaps
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

    function testExitAcceptsDifferentOutputTokenAndSkipsDirectConstituentLeg() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        exitAdapter.setRate(address(tokenB), address(tokenA), 1, 1);

        ExitSwap[] memory swaps = new ExitSwap[](2);
        swaps[0] = ExitSwap({ adapter: address(0), minOutputAmount: 0, adapterData: "" });
        swaps[1] = ExitSwap({
            adapter: address(exitAdapter),
            minOutputAmount: expectedAssets[1],
            adapterData: ""
        });

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        uint256 received = entryRouter.redeemToToken(
            address(vault), address(tokenA), shares, ALICE,
            expectedAssets[0] + expectedAssets[1], block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(received, expectedAssets[0] + expectedAssets[1]);
        assertEq(tokenA.balanceOf(ALICE), received);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
    }

    function testSettlementExitSupportsSettlementConstituentFirst() public {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenC);
        assets[1] = address(tokenA);
        _assertSettlementConstituentExit(assets);
    }

    function testSettlementExitSupportsSettlementConstituentAfterSwap() public {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenC);
        _assertSettlementConstituentExit(assets);
    }

    function testSettlementExitSupportsSettlementConstituentBetweenSwaps() public {
        address[] memory assets = new address[](3);
        assets[0] = address(tokenA);
        assets[1] = address(tokenC);
        assets[2] = address(tokenB);
        _assertSettlementConstituentExit(assets);
    }

    function testSettlementExitMinimumAndAdapterApprovalRevertAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        ExitSwap[] memory swaps = _exitSwaps(0, 0);

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        vm.expectPartialRevert(OTFEntryExitRouter.MinimumOutputNotMet.selector);
        entryRouter.redeemToToken(
            address(vault),
            address(tokenC),
            shares,
            ALICE,
            expectedAssets[0] + expectedAssets[1] + 1,
            block.timestamp + 1 hours,
            swaps
        );
        vm.stopPrank();
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenC.balanceOf(ALICE), 10_000 * ONE);

        entryRouter.setTradeAdapterApproved(address(exitAdapter), false);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.UnapprovedTradeAdapter.selector);
        entryRouter.redeemToToken(
            address(vault), address(tokenC), shares, ALICE, 1, block.timestamp + 1 hours, swaps
        );
        assertEq(vault.balanceOf(ALICE), shares);
    }

    function testSettlementExitEnforcesEachObservedLegMinimum() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);

        MinimumIgnoringTradeAdapter minimumIgnoringAdapter = new MinimumIgnoringTradeAdapter();
        entryRouter.setTradeAdapterApproved(address(minimumIgnoringAdapter), true);
        tokenC.mint(address(minimumIgnoringAdapter), expectedAssets[0]);
        exitAdapter.setRate(address(tokenB), address(tokenC), 2, 1);

        ExitSwap[] memory swaps = _exitSwaps(expectedAssets[0], expectedAssets[1]);
        swaps[0].adapter = address(minimumIgnoringAdapter);
        uint256 observedFirstLeg = expectedAssets[0] / 2;

        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.MinimumOutputNotMet.selector, expectedAssets[0], observedFirstLeg
            )
        );
        entryRouter.redeemToToken(
            address(vault),
            address(tokenC),
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

    function _exitSwaps(uint256 minA, uint256 minB) private view returns (ExitSwap[] memory swaps) {
        swaps = new ExitSwap[](2);
        swaps[0] =
            ExitSwap({ adapter: address(exitAdapter), minOutputAmount: minA, adapterData: "" });
        swaps[1] =
            ExitSwap({ adapter: address(exitAdapter), minOutputAmount: minB, adapterData: "" });
    }

    function _assertSettlementConstituentExit(address[] memory assets) private {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = assets;
        params.initialPricingConfigs = _pricingConfigsFor(assets);
        params.initialTargetWeightsBps = new uint16[](assets.length);
        params.initialAmounts = new uint256[](assets.length);
        uint16 equalWeight = uint16(10_000 / assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            params.initialTargetWeightsBps[i] = equalWeight;
            params.initialAmounts[i] = 500 * ONE;
        }
        params.initialTargetWeightsBps[0] += uint16(10_000 % assets.length);

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        uint256 shares = 10 * ONE;
        vault.transfer(ALICE, shares);
        uint256[] memory expectedAssets = vault.previewRedeem(shares);
        ExitSwap[] memory swaps = new ExitSwap[](assets.length);
        uint256 expectedSettlement;
        for (uint256 i = 0; i < assets.length; i++) {
            expectedSettlement += expectedAssets[i];
            if (assets[i] != address(tokenC)) {
                swaps[i] = ExitSwap({
                    adapter: address(exitAdapter),
                    minOutputAmount: expectedAssets[i],
                    adapterData: ""
                });
            }
        }

        uint256 settlementBefore = tokenC.balanceOf(ALICE);
        vm.startPrank(ALICE);
        vault.approve(address(entryRouter), shares);
        uint256 received = entryRouter.redeemToToken(
            address(vault), address(tokenC), shares, ALICE, expectedSettlement,
            block.timestamp + 1 hours, swaps
        );
        vm.stopPrank();

        assertEq(received, expectedSettlement);
        assertEq(tokenC.balanceOf(ALICE), settlementBefore + expectedSettlement);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenA.balanceOf(address(entryRouter)), 0);
        assertEq(tokenB.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
    }

    function _entrySwaps(uint256 settlementA, uint256 settlementB)
        private
        view
        returns (EntrySwap[] memory swaps)
    {
        swaps = new EntrySwap[](2);
        swaps[0] = EntrySwap({
            adapter: address(exitAdapter),
            inputAmount: settlementA,
            minAssetOut: 0,
            minRefundInputRate: ONE,
            adapterData: "",
            refundAdapterData: ""
        });
        swaps[1] = EntrySwap({
            adapter: address(exitAdapter),
            inputAmount: settlementB,
            minAssetOut: 0,
            minRefundInputRate: ONE,
            adapterData: "",
            refundAdapterData: ""
        });
    }
}
