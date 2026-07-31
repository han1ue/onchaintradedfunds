// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ERC7621CompatibilityTest is ProtocolTestBase {
    event Contributed(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Withdrawn(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Rebalanced(address[] newTokens, uint256[] newWeights);

    function testSupportsERC165ERC173AndDraftERC7621() public {
        ManagedOTFVault vault = _createVault();

        assertEq(type(IERC7621).interfaceId, bytes4(0xc9c80f73));
        assertTrue(vault.supportsInterface(0x01ffc9a7));
        assertTrue(vault.supportsInterface(0x7f5828d0));
        assertTrue(vault.supportsInterface(type(IERC7621).interfaceId));
        assertFalse(vault.supportsInterface(0xffffffff));
        assertEq(vault.owner(), address(this));
    }

    function testConstituentViewsFollowStandardSemantics() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory constituents, uint256[] memory weights) = vault.getConstituents();

        assertEq(constituents.length, 2);
        assertEq(weights.length, 2);
        assertEq(constituents[0], address(tokenA));
        assertEq(constituents[1], address(tokenB));
        assertEq(weights[0], 5_000);
        assertEq(weights[1], 5_000);
        assertEq(vault.totalConstituents(), 2);
        assertEq(vault.getReserve(address(tokenA)), 500 * ONE);
        assertEq(vault.getReserve(address(tokenC)), 0);
        assertEq(vault.getWeight(address(tokenA)), 5_000);
        assertTrue(vault.isConstituent(address(tokenA)));
        assertFalse(vault.isConstituent(address(tokenC)));

        vm.expectPartialRevert(IERC7621.NotConstituent.selector);
        vault.getWeight(address(tokenC));
    }

    function testStandardContributeMintsProportionalSharesAndEmitsExactEvent() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory amounts = vault.previewMint(shares);
        assertEq(vault.previewContribute(amounts), shares);

        tokenA.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Contributed(ALICE, ALICE, shares, amounts);
        uint256 minted = vault.contribute(amounts, ALICE, shares);
        vm.stopPrank();

        assertEq(minted, shares);
        assertEq(vault.balanceOf(ALICE), shares);
    }

    function testPreviewsMatchActionsAfterPendingFeeAccrual() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 30 days);
        uint256 shares = 10 * ONE;
        uint256[] memory amounts = vault.previewMint(shares);
        uint256 previewedShares = vault.previewContribute(amounts);
        uint256[] memory previewedWithdrawal = vault.previewWithdraw(shares);

        tokenA.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        assertEq(vault.contribute(amounts, ALICE, previewedShares), previewedShares);
        uint256[] memory actualWithdrawal = vault.withdraw(shares, ALICE, previewedWithdrawal);
        vm.stopPrank();

        assertEq(actualWithdrawal[0], previewedWithdrawal[0]);
        assertEq(actualWithdrawal[1], previewedWithdrawal[1]);
    }

    function testStandardWithdrawIsProportionalAndEmitsExactEvent() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory expected = vault.previewWithdraw(shares);
        uint256[] memory minimums = expected;

        vm.expectEmit(true, true, false, true, address(vault));
        emit Withdrawn(address(this), ALICE, shares, expected);
        uint256[] memory actual = vault.withdraw(shares, ALICE, minimums);

        assertEq(actual[0], expected[0]);
        assertEq(actual[1], expected[1]);
        assertEq(tokenA.balanceOf(ALICE), expected[0]);
        assertEq(tokenB.balanceOf(ALICE), expected[1]);
    }

    function testPreviewZeroAndLengthSemanticsMatchDraft() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory zeros = new uint256[](2);
        assertEq(vault.previewContribute(zeros), 0);
        uint256[] memory withdrawal = vault.previewWithdraw(0);
        assertEq(withdrawal[0], 0);
        assertEq(withdrawal[1], 0);

        uint256[] memory wrongLength = new uint256[](1);
        vm.expectPartialRevert(IERC7621.LengthMismatch.selector);
        vault.previewContribute(wrongLength);
    }

    function testNonProportionalContributionIsRejectedRatherThanDonated() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10 * ONE;
        amounts[1] = 9 * ONE;

        vm.expectPartialRevert(ManagedOTFVaultStorage.NonProportionalContribution.selector);
        vault.previewContribute(amounts);
    }

    function testStandardRebalancedEventMeansTargetsChangedNotTradesCompleted() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory narrowWeights) = _sixtyFortyPortfolio();
        uint256[] memory weights = _uint256Weights(narrowWeights);
        vm.warp(START + 7 days);

        vm.expectEmit(false, false, false, true, address(vault));
        emit Rebalanced(assets, weights);
        vault.rebalance(assets, weights);

        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertTrue(vault.strategicRebalanceActive());
        assertEq(vault.rebalanceCount(), 0);
    }

    function testERC173OwnershipTransferClearsExecutors() public {
        ManagedOTFVault vault = _createVault();
        vault.setExecutor(ALICE, true);

        vault.transferOwnership(BOB);

        assertEq(vault.owner(), BOB);
        assertEq(vault.manager(), BOB);
        assertFalse(vault.authorizedExecutor(ALICE));
    }
}
