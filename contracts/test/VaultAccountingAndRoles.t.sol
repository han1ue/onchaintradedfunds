// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../src/ERC20Base.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { ThesisVersion, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract VaultAccountingAndRolesTest is ProtocolTestBase {
    function testInitializationStoresPortfolioAndMintsInitialShares() public {
        ManagedOTFVault vault = _createVault();

        assertEq(vault.name(), "Test OTF");
        assertEq(vault.symbol(), "OTF-TEST");
        assertEq(vault.decimals(), 18);
        assertEq(vault.manager(), address(this));
        assertEq(vault.feeRecipient(), FEE_RECIPIENT);
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(vault.balanceOf(address(this)), 100 * ONE - vault.MINIMUM_LIQUIDITY_SHARES());
        assertEq(vault.balanceOf(address(vault)), vault.MINIMUM_LIQUIDITY_SHARES());
        assertEq(vault.assetCount(), 2);
        assertEq(vault.assetAt(0), address(tokenA));
        assertEq(vault.assetAt(1), address(tokenB));
        assertEq(vault.targetWeightBps(address(tokenA)), 5_000);
        assertEq(vault.targetWeightBps(address(tokenB)), 5_000);
        assertEq(vault.lastRebalanceTimestamp(), START);
        assertEq(vault.lastFeeAccrualTimestamp(), START);
        assertEq(vault.thesisVersionCount(), 1);
        assertEq(vault.currentThesis(), "A test portfolio with explicit safety limits.");
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testNavAndCurrentWeightsUseOraclePrices() public {
        ManagedOTFVault vault = _createVault();

        assertEq(vault.totalAssetsValue(), 100_000 * ONE);
        assertEq(vault.navPerShare(), 1_000 * ONE);
        uint16[] memory weights = vault.currentWeightsBps();
        assertEq(weights[0], 5_000);
        assertEq(weights[1], 5_000);

        feedA.setRoundData(2, 200_00000000, block.timestamp, block.timestamp, 2);
        assertEq(vault.totalAssetsValue(), 150_000 * ONE);
        weights = vault.currentWeightsBps();
        assertEq(weights[0], 6_666);
        assertEq(weights[1], 3_333);
    }

    function testMintWithBasketAndRedeemAreProportional() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory quotedIn = vault.previewMint(shares);
        assertEq(quotedIn[0], 50 * ONE);
        assertEq(quotedIn[1], 50 * ONE);

        tokenA.mint(ALICE, 100 * ONE);
        tokenB.mint(ALICE, 100 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, quotedIn);
        vm.stopPrank();

        assertEq(vault.totalSupply(), 110 * ONE);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenA.balanceOf(address(vault)), 550 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 550 * ONE);

        uint256[] memory quotedOut = vault.previewRedeem(shares);
        assertEq(quotedOut[0], 50 * ONE);
        assertEq(quotedOut[1], 50 * ONE);

        uint256[] memory minimums = new uint256[](2);
        minimums[0] = quotedOut[0];
        minimums[1] = quotedOut[1];
        vm.prank(ALICE);
        vault.redeem(shares, ALICE, ALICE, minimums);

        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testMintMaximumInputProtectsUserAndRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory maximums = vault.previewMint(10 * ONE);
        maximums[0] -= 1;

        tokenA.mint(ALICE, 100 * ONE);
        tokenB.mint(ALICE, 100 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AmountTooHigh.selector);
        vault.mintWithBasket(10 * ONE, ALICE, maximums);
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
    }

    function testRedeemMinimumOutputProtectsUserAndRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory minimums = vault.previewRedeem(10 * ONE);
        minimums[0] += 1;

        vm.expectPartialRevert(IERC7621.InsufficientAmount.selector);
        vault.redeem(10 * ONE, address(this), address(this), minimums);

        assertEq(vault.balanceOf(address(this)), 100 * ONE - vault.MINIMUM_LIQUIDITY_SHARES());
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
    }

    function testDelegatedRedeemConsumesAllowance() public {
        ManagedOTFVault vault = _createVault();
        vault.transfer(ALICE, 20 * ONE);

        vm.prank(ALICE);
        vault.approve(BOB, 10 * ONE);
        uint256[] memory minimums = new uint256[](2);
        vm.prank(BOB);
        vault.redeem(10 * ONE, BOB, ALICE, minimums);

        assertEq(vault.balanceOf(ALICE), 10 * ONE);
        assertEq(vault.allowance(ALICE, BOB), 0);
        assertEq(tokenA.balanceOf(BOB), 50 * ONE);
        assertEq(tokenB.balanceOf(BOB), 50 * ONE);
    }

    function testApproveRequiresZeroResetBeforeNonzeroReplacement() public {
        ManagedOTFVault vault = _createVault();
        vault.transfer(ALICE, 20 * ONE);

        vm.startPrank(ALICE);
        vault.approve(BOB, 10 * ONE);
        vm.expectPartialRevert(ERC20Base.ERC20NonZeroAllowance.selector);
        vault.approve(BOB, 5 * ONE);

        vault.approve(BOB, 0);
        vault.approve(BOB, 5 * ONE);
        vm.stopPrank();

        assertEq(vault.allowance(ALICE, BOB), 5 * ONE);
    }

    function testFeeAccrualMintsExactCreatorAndProtocolShares() public {
        ManagedOTFVault vault = _createVault();
        uint256 elapsed = 30 days;
        vm.warp(START + elapsed);

        uint256 numerator = uint256(100) * elapsed;
        uint256 annualDenominator = 10_000 * 365 days;
        uint256 expectedFeeShares = (100 * ONE * numerator) / (annualDenominator - numerator);
        uint256 expectedProtocolShares = expectedFeeShares * 1_500 / 10_000;
        uint256 expectedCreatorShares = expectedFeeShares - expectedProtocolShares;

        uint256 minted = vault.accrueFees();
        assertEq(minted, expectedFeeShares);
        assertEq(vault.balanceOf(address(collector)), expectedProtocolShares);
        assertEq(vault.balanceOf(FEE_RECIPIENT), expectedCreatorShares);
        assertEq(vault.totalSupply(), 100 * ONE + expectedFeeShares);
        assertEq(vault.lastFeeAccrualTimestamp(), START + elapsed);
    }

    function testFeeAccrualTwiceAtSameTimestampMintsOnlyOnce() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);

        uint256 first = vault.accrueFees();
        uint256 supply = vault.totalSupply();
        uint256 second = vault.accrueFees();

        assertGt(first, 0);
        assertEq(second, 0);
        assertEq(vault.totalSupply(), supply);
    }

    function testZeroShareFeeAccrualDoesNotDiscardElapsedTime() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = 1_000_001;
        params.creatorFeeBpsPerYear = 1_000;
        ManagedOTFVault fragmentedVault = ManagedOTFVault(factory.createVault(params));
        ManagedOTFVault singleIntervalVault = ManagedOTFVault(factory.createVault(params));

        vm.warp(START + 1);
        assertEq(fragmentedVault.accrueFees(), 0);
        assertEq(fragmentedVault.lastFeeAccrualTimestamp(), START);

        uint256 fragmentedFees;
        for (uint256 i = 2; i <= 400; i++) {
            vm.warp(START + i);
            fragmentedFees += fragmentedVault.accrueFees();
        }

        vm.warp(START + 400);
        uint256 singleIntervalFees = singleIntervalVault.accrueFees();

        assertGt(singleIntervalFees, 0);
        assertEq(fragmentedFees, singleIntervalFees);
        assertEq(fragmentedVault.totalSupply(), singleIntervalVault.totalSupply());
    }

    function testLongDormancyAccruesWithoutBrickingVault() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 36_500 days);

        uint256 accrued = vault.accrueFees();

        assertGt(accrued, 0);
        assertEq(vault.lastFeeAccrualTimestamp(), START + 36_500 days);
        assertGt(vault.totalSupply(), 100 * ONE);
    }

    function testOnlyManagerCanAmendThesis() public {
        ManagedOTFVault vault = _createVault();
        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.appendThesisAmendment("Unauthorized amendment");

        vm.warp(START + 1 days);
        vault.appendThesisAmendment("Authorized amendment");
        assertEq(vault.thesisVersionCount(), 2);
        assertEq(vault.currentThesis(), "Authorized amendment");
        ThesisVersion memory version = vault.getThesisVersion(1);
        assertEq(version.author, address(this));
        assertEq(version.timestamp, START + 1 days);
    }

    function testThesisLengthLimitIsEnforced() public {
        ManagedOTFVault vault = _createVault();
        string memory oversized = _stringOfLength(2_049);
        vm.expectPartialRevert(ManagedOTFVaultStorage.ThesisTooLong.selector);
        vault.appendThesisAmendment(oversized);
    }

    function testManagerTransferIsTwoStepAndAccruesFees() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);
        vault.beginManagerTransfer(ALICE);

        assertEq(vault.pendingManager(), ALICE);
        assertGt(vault.totalSupply(), 100 * ONE);
        vm.prank(BOB);
        vm.expectRevert(ManagedOTFVaultStorage.NotPendingManager.selector);
        vault.acceptManagerTransfer();

        vm.prank(ALICE);
        vault.acceptManagerTransfer();
        assertEq(vault.manager(), ALICE);
        assertEq(vault.pendingManager(), address(0));

        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.appendThesisAmendment("Old manager cannot amend.");
        vm.prank(ALICE);
        vault.appendThesisAmendment("New manager amendment.");
    }

    function testFeeRecipientTransferIsTwoStep() public {
        ManagedOTFVault vault = _createVault();
        vault.beginFeeRecipientTransfer(ALICE);
        vm.prank(BOB);
        vm.expectRevert(ManagedOTFVaultStorage.NotPendingFeeRecipient.selector);
        vault.acceptFeeRecipientTransfer();

        vm.prank(ALICE);
        vault.acceptFeeRecipientTransfer();
        assertEq(vault.feeRecipient(), ALICE);
        assertEq(vault.pendingFeeRecipient(), address(0));
    }

    function testERC20RejectsZeroReceiverAndInsufficientAllowance() public {
        ManagedOTFVault vault = _createVault();
        vm.expectPartialRevert(ERC20Base.ERC20InvalidReceiver.selector);
        vault.transfer(address(0), ONE);

        vm.prank(BOB);
        vm.expectPartialRevert(ERC20Base.ERC20InsufficientAllowance.selector);
        vault.transferFrom(address(this), BOB, ONE);
    }

    function testZeroShareAndBadArrayOperationsRevert() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(ManagedOTFVaultStorage.ZeroShares.selector);
        vault.previewMint(0);
        vm.expectRevert(ManagedOTFVaultStorage.ZeroShares.selector);
        vault.previewRedeem(0);
        vm.expectRevert(ManagedOTFVaultStorage.InvalidArrayLength.selector);
        vault.mintWithBasket(ONE, address(this), empty);
        vm.expectRevert(ManagedOTFVaultStorage.InvalidArrayLength.selector);
        vault.redeem(ONE, address(this), address(this), empty);
    }

    function _stringOfLength(uint256 length) private pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            value[i] = bytes1("x");
        }
        return string(value);
    }
}
