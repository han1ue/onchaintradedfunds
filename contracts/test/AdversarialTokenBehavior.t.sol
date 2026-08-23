// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { MockAdversarialERC20 } from "../src/mocks/MockAdversarialERC20.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { PricingSource, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract SafeTransferHarness {
    using SafeTransferLib for address;

    function transferToken(address token, address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }

    function transferTokenFrom(address token, address from, address to, uint256 amount) external {
        token.safeTransferFrom(from, to, amount);
    }

    function approveToken(address token, address spender, uint256 amount) external {
        token.safeApprove(spender, amount);
    }
}

contract AdversarialTokenBehaviorTest is ProtocolTestBase {
    function testSafeTransferLibAcceptsNoReturnData() public {
        (MockAdversarialERC20 token, SafeTransferHarness harness) = _configuredHarnessToken();
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.NoReturn);

        harness.transferToken(address(token), ALICE, 10);
        harness.transferTokenFrom(address(token), address(this), BOB, 20);
        harness.approveToken(address(token), BOB, 30);

        assertEq(token.balanceOf(ALICE), 10);
        assertEq(token.balanceOf(BOB), 20);
        assertEq(token.balanceOf(address(harness)), 90);
        assertEq(token.allowance(address(this), address(harness)), 80);
        assertEq(token.allowance(address(harness), BOB), 30);
    }

    function testSafeTransferLibRejectsFalseReturnDataAtomically() public {
        (MockAdversarialERC20 token, SafeTransferHarness harness) = _configuredHarnessToken();
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.False);

        vm.expectRevert(SafeTransferLib.SafeTransferFailed.selector);
        harness.transferToken(address(token), ALICE, 10);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        harness.transferTokenFrom(address(token), address(this), BOB, 20);
        vm.expectRevert(SafeTransferLib.SafeApproveFailed.selector);
        harness.approveToken(address(token), BOB, 30);

        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(token.balanceOf(address(harness)), 100);
        assertEq(token.balanceOf(address(this)), 100);
        assertEq(token.allowance(address(this), address(harness)), 100);
        assertEq(token.allowance(address(harness), BOB), 0);
    }

    function testSafeTransferLibRejectsMalformedReturnDataAtomically() public {
        (MockAdversarialERC20 token, SafeTransferHarness harness) = _configuredHarnessToken();
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.Malformed);

        vm.expectRevert();
        harness.transferToken(address(token), ALICE, 10);
        vm.expectRevert();
        harness.transferTokenFrom(address(token), address(this), BOB, 20);
        vm.expectRevert();
        harness.approveToken(address(token), BOB, 30);

        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(token.balanceOf(address(harness)), 100);
        assertEq(token.balanceOf(address(this)), 100);
        assertEq(token.allowance(address(this), address(harness)), 100);
        assertEq(token.allowance(address(harness), BOB), 0);
    }

    function testVaultRejectsSenderOverdebitAtomically() public {
        (MockAdversarialERC20 token, ManagedOTFVault vault) = _createAdversarialVault(false);
        uint256[] memory amounts = _fundAndApproveAlice(vault, token, ONE, 1);
        uint256 vaultBalanceBefore = token.balanceOf(address(vault));
        uint256 aliceBalanceBefore = token.balanceOf(ALICE);
        token.setTransferMutation(MockAdversarialERC20.TransferMutation.SenderOverdebit, 1);

        vm.startPrank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        vault.mintWithBasket(ONE, ALICE, amounts);
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore);
        assertEq(token.balanceOf(ALICE), aliceBalanceBefore);
    }

    function testVaultRejectsTouchedBalanceRebaseAtomically() public {
        (MockAdversarialERC20 token, ManagedOTFVault vault) = _createAdversarialVault(false);
        uint256[] memory amounts = _fundAndApproveAlice(vault, token, ONE, 0);
        uint256 supplyBefore = token.totalSupply();
        uint256 vaultBalanceBefore = token.balanceOf(address(vault));
        uint256 aliceBalanceBefore = token.balanceOf(ALICE);
        token.setTransferMutation(MockAdversarialERC20.TransferMutation.TouchedBalanceRebase, 1);

        vm.startPrank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        vault.mintWithBasket(ONE, ALICE, amounts);
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore);
        assertEq(token.balanceOf(ALICE), aliceBalanceBefore);
    }

    function testVaultRejectsFalseReturnOnPullAndPushAtomically() public {
        (MockAdversarialERC20 token, ManagedOTFVault vault) = _createAdversarialVault(false);
        uint256[] memory amounts = _fundAndApproveAlice(vault, token, ONE, 0);
        uint256 managerSharesBefore = vault.balanceOf(address(this));
        uint256 supplyBefore = vault.totalSupply();
        uint256 vaultBalanceBefore = token.balanceOf(address(vault));
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.False);

        vm.startPrank(ALICE);
        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        vault.mintWithBasket(ONE, ALICE, amounts);
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.expectRevert(SafeTransferLib.SafeTransferFailed.selector);
        vault.redeem(ONE, ALICE, address(this), minimums);

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.balanceOf(address(this)), managerSharesBefore);
        assertEq(vault.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore);
    }

    function testVaultRejectsMalformedReturnOnPullAndPushAtomically() public {
        (MockAdversarialERC20 token, ManagedOTFVault vault) = _createAdversarialVault(false);
        uint256[] memory amounts = _fundAndApproveAlice(vault, token, ONE, 0);
        uint256 managerSharesBefore = vault.balanceOf(address(this));
        uint256 supplyBefore = vault.totalSupply();
        uint256 vaultBalanceBefore = token.balanceOf(address(vault));
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.Malformed);

        vm.startPrank(ALICE);
        vm.expectRevert();
        vault.mintWithBasket(ONE, ALICE, amounts);
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.expectRevert();
        vault.redeem(ONE, ALICE, address(this), minimums);

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.balanceOf(address(this)), managerSharesBefore);
        assertEq(vault.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore);
    }

    function testVaultSupportsNoReturnTokenAcrossCreationMintAndRedeem() public {
        (MockAdversarialERC20 token, ManagedOTFVault vault) = _createAdversarialVault(true);
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.True);
        uint256[] memory amounts = _fundAndApproveAlice(vault, token, ONE, 0);
        token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.NoReturn);

        vm.prank(ALICE);
        vault.mintWithBasket(ONE, ALICE, amounts);
        assertEq(vault.balanceOf(ALICE), ONE);

        uint256[] memory minimums = new uint256[](2);
        vm.prank(ALICE);
        uint256[] memory received = vault.redeem(ONE, ALICE, ALICE, minimums);

        assertEq(vault.balanceOf(ALICE), 0);
        assertGt(received[0], 0);
        assertGt(received[1], 0);
        assertEq(token.balanceOf(ALICE), received[0]);
        assertEq(tokenB.balanceOf(ALICE), received[1]);
    }

    function _configuredHarnessToken()
        private
        returns (MockAdversarialERC20 token, SafeTransferHarness harness)
    {
        token = new MockAdversarialERC20("Adversarial", "ADV", 18);
        harness = new SafeTransferHarness();
        token.mint(address(harness), 100);
        token.mint(address(this), 100);
        token.approve(address(harness), 100);
    }

    function _createAdversarialVault(bool noReturnDuringCreation)
        private
        returns (MockAdversarialERC20 token, ManagedOTFVault vault)
    {
        MockPriceFeed feed;
        (token, feed) = _configureAdversarialToken();
        if (noReturnDuringCreation) {
            token.setReturnBehavior(MockAdversarialERC20.ReturnBehavior.NoReturn);
        }
        VaultInitParams memory params = _defaultParams();
        params.initialAssets[0] = address(token);
        params.initialPricingConfigs[0] = _directPricing(address(feed), PricingSource.Chainlink);
        vault = ManagedOTFVault(factory.createVault(params));
    }

    function _configureAdversarialToken()
        private
        returns (MockAdversarialERC20 token, MockPriceFeed feed)
    {
        token = new MockAdversarialERC20("Adversarial Stock", "ADV", 18);
        feed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.registerAsset(address(token));
        token.mint(address(this), 10_000 * ONE);
        token.approve(address(factory), type(uint256).max);
    }

    function _fundAndApproveAlice(
        ManagedOTFVault vault,
        MockAdversarialERC20 token,
        uint256 shares,
        uint256 extraToken
    ) private returns (uint256[] memory amounts) {
        amounts = vault.previewMint(shares);
        token.mint(ALICE, amounts[0] + extraToken);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        token.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }
}
