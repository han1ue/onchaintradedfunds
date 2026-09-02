// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { MockAdversarialERC20 } from "./mocks/MockAdversarialERC20.sol";
import { MockFeeOnTransferToken } from "./mocks/MockFeeOnTransferToken.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import {
    BootstrapTestBase,
    CrossMutatingToken,
    MockBuybackReceiver,
    MockCoreRouter,
    SlashableToken
} from "./BootstrapTestBase.sol";

contract VaultAccountingTest is BootstrapTestBase {
    OTFFactory internal factory;
    address internal collector;
    MockCoreRouter internal router;
    MockStockToken internal tokenA;
    MockStockToken internal tokenB;

    function setUp() public {
        (factory, collector, router) = _deployFactory();
        tokenA = new MockStockToken("Asset A", "A", 18);
        tokenB = new MockStockToken("Asset B", "B", 18);
    }

    function testOneYearAtTenPercentLeavesHolderAtExactlyNinetyPercent() public {
        ManagedOTFVault vault = _newVault(1, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(vault, router, assets, 100 * WAD);

        vm.warp(block.timestamp + 365 days);
        uint256 expectedFeeShares = (100 * WAD) / 9;
        assertApproxEqAbs(vault.pendingExpenseFeeShares(), expectedFeeShares, 1);
        uint256 minted = vault.checkpointFees();

        assertApproxEqAbs(minted, expectedFeeShares, 1);
        assertEq(vault.balanceOf(ALICE) * 10_000 / vault.totalSupply(), 9_000);
        assertEq(vault.balanceOf(BENEFICIARY), 0);
        assertEq(vault.balanceOf(collector), minted);
        assertEq(
            MockBuybackReceiver(collector).creatorFeeShares(address(vault)), minted * 5_000 / 10_000
        );
        assertEq(
            MockBuybackReceiver(collector).buybackFeeShares(address(vault)),
            minted - (minted * 5_000 / 10_000)
        );
    }

    function testManualCheckpointCadenceIsIndependentAndCarriesSplitRemainders() public {
        ManagedOTFVault once = _newVault(2, 1_000);
        ManagedOTFVault monthly = _newVault(3, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(once, router, assets, 100 * WAD);
        _bootstrap(monthly, router, assets, 100 * WAD);
        uint256 start = block.timestamp;

        for (uint256 i = 1; i <= 12; i++) {
            vm.warp(start + 365 days * i / 12);
            monthly.checkpointFees();
        }
        once.checkpointFees();

        assertEq(monthly.totalSupply(), once.totalSupply());
        assertEq(monthly.balanceOf(BENEFICIARY), 0);
        assertEq(monthly.balanceOf(collector), once.balanceOf(collector));
        assertEq(
            MockBuybackReceiver(collector).creatorFeeShares(address(monthly)),
            MockBuybackReceiver(collector).creatorFeeShares(address(once))
        );
        assertEq(
            MockBuybackReceiver(collector).buybackFeeShares(address(monthly)),
            MockBuybackReceiver(collector).buybackFeeShares(address(once))
        );
    }

    function testOneYearBoundaryIsMonotonic() public {
        ManagedOTFVault beforeBoundary = _newVault(18, 1_000);
        ManagedOTFVault exactBoundary = _newVault(19, 1_000);
        ManagedOTFVault afterBoundary = _newVault(20, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(beforeBoundary, router, assets, 100 * WAD);
        _bootstrap(exactBoundary, router, assets, 100 * WAD);
        _bootstrap(afterBoundary, router, assets, 100 * WAD);
        uint256 start = block.timestamp;
        uint256 beforeTimestamp = start + 365 days - 1;
        uint256 exactTimestamp = start + 365 days;
        uint256 afterTimestamp = start + 365 days + 1;

        vm.warp(beforeTimestamp);
        uint256 beforeShares = beforeBoundary.pendingExpenseFeeShares();
        vm.warp(exactTimestamp);
        uint256 exactShares = exactBoundary.pendingExpenseFeeShares();
        vm.warp(afterTimestamp);
        uint256 afterShares = afterBoundary.pendingExpenseFeeShares();

        assertLe(beforeShares, exactShares);
        assertLe(exactShares, afterShares);
        assertApproxEqAbs(exactShares, (100 * WAD) / 9, 1);
    }

    function testFuzzManualCheckpointCadenceIndependence(uint8 checkpointSeed, uint64 elapsedSeed)
        public
    {
        ManagedOTFVault once = _newVault(21, 1_000);
        ManagedOTFVault stepped = _newVault(22, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(once, router, assets, 100 * WAD);
        _bootstrap(stepped, router, assets, 100 * WAD);
        uint256 start = block.timestamp;
        uint256 checkpoints = bound(checkpointSeed, 1, 24);
        uint256 elapsed = bound(elapsedSeed, 1, 50 * 365 days);

        for (uint256 i = 1; i < checkpoints; i++) {
            vm.warp(start + elapsed * i / checkpoints);
            stepped.checkpointFees();
        }
        vm.warp(start + elapsed);
        stepped.checkpointFees();
        once.checkpointFees();

        assertEq(stepped.totalSupply(), once.totalSupply());
        assertEq(stepped.balanceOf(BENEFICIARY), 0);
        assertEq(stepped.balanceOf(collector), once.balanceOf(collector));
        assertEq(
            MockBuybackReceiver(collector).creatorFeeShares(address(stepped)),
            MockBuybackReceiver(collector).creatorFeeShares(address(once))
        );
        assertEq(
            MockBuybackReceiver(collector).buybackFeeShares(address(stepped)),
            MockBuybackReceiver(collector).buybackFeeShares(address(once))
        );
    }

    function testLongDormancyAndFeeCheckpointBeforeSupplyMath() public {
        ManagedOTFVault vault = _newVault(4, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(vault, router, assets, 10 * WAD);

        vm.warp(block.timestamp + 50 * 365 days);
        assertGt(vault.pendingExpenseFeeShares(), 1_000 * WAD);
        uint256[] memory preview = vault.previewMint(WAD);
        tokenA.mint(address(router), preview[0]);
        tokenB.mint(address(router), preview[1]);
        router.approveAsset(address(tokenA), address(vault), preview[0]);
        router.approveAsset(address(tokenB), address(vault), preview[1]);
        uint256 beforeA = vault.accountedBalance(address(tokenA));
        router.mint(vault, WAD, BOB, preview);

        assertEq(vault.accountedBalance(address(tokenA)), beforeA + preview[0]);
        assertEq(vault.balanceOf(BOB), WAD);
    }

    function testShareTransfersFeeClaimsAndRedemptionsDoNotChangeAccountedBasket() public {
        ManagedOTFVault vault = _newVault(5, 1_000);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(vault, router, assets, 10 * WAD);
        uint256 accountedA = vault.accountedBalance(address(tokenA));
        uint256 accountedB = vault.accountedBalance(address(tokenB));

        vm.prank(ALICE);
        vault.transfer(BOB, WAD);
        assertEq(vault.accountedBalance(address(tokenA)), accountedA);
        assertEq(vault.accountedBalance(address(tokenB)), accountedB);

        vm.warp(block.timestamp + 365 days);
        vault.checkpointFees();
        assertGt(vault.balanceOf(collector), 0);
        assertEq(vault.accountedBalance(address(tokenA)), accountedA);
        assertEq(vault.accountedBalance(address(tokenB)), accountedB);

        vm.prank(BOB);
        vault.approve(address(router), WAD);
        uint256[] memory expected = vault.previewRedeem(WAD);
        router.redeem(vault, WAD, BOB, BOB, _zeroes(2));
        assertEq(vault.accountedBalance(address(tokenA)), accountedA - expected[0]);
        assertEq(vault.accountedBalance(address(tokenB)), accountedB - expected[1]);
    }

    function testDonationsNeverChangeNormalOrEmergencyEntitlement() public {
        ManagedOTFVault vault = _newVault(6, 0);
        address[] memory assets = _assets(address(tokenA), address(tokenB));
        _bootstrap(vault, router, assets, WAD);
        uint256[] memory entitlement = vault.previewRedeem(WAD);
        tokenA.mint(address(vault), 7 * WAD);
        uint256[] memory afterDonation = vault.previewRedeem(WAD);
        assertEq(afterDonation[0], entitlement[0]);
        assertEq(afterDonation[1], entitlement[1]);

        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();
        vm.prank(ALICE);
        vault.emergencyRedeem(WAD, ALICE, _zeroes(2));

        assertEq(tokenA.balanceOf(ALICE), entitlement[0]);
        assertEq(tokenA.balanceOf(address(vault)), 7 * WAD);
        assertEq(vault.accountedBalance(address(tokenA)), 0);
        assertEq(vault.totalSupply(), 0);
    }

    function testNonCreatorCannotShutdownSoundOrDonationBackedVault() public {
        ManagedOTFVault vault = _newVault(15, 0);
        _bootstrap(vault, router, _assets(address(tokenA), address(tokenB)), WAD);

        vm.prank(BOB);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnauthorizedShutdown.selector);
        vault.activateEmergencyShutdown();

        tokenA.mint(address(vault), WAD);
        vm.prank(BOB);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnauthorizedShutdown.selector);
        vault.activateEmergencyShutdown();
        assertFalse(vault.shutdown());
    }

    function testEmergencyRedeemHandlesDeficitButNormalRedeemFailsClosed() public {
        SlashableToken lossToken = new SlashableToken("Lossy", "LOSS", 18);
        SlashableToken soundToken = new SlashableToken("Sound", "SOUND", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(lossToken), address(soundToken), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        lossToken.mint(address(router), amounts[0]);
        soundToken.mint(address(router), amounts[1]);
        router.approveAsset(address(lossToken), address(vault), amounts[0]);
        router.approveAsset(address(soundToken), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);
        vm.prank(ALICE);
        vault.transfer(BOB, WAD / 2);
        lossToken.slash(address(vault), amounts[0] / 2);

        vm.prank(ALICE);
        vault.approve(address(router), WAD / 2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BackingDeficient.selector);
        router.redeem(vault, WAD / 2, ALICE, ALICE, _zeroes(2));

        vm.prank(address(0xD1E7));
        vault.activateEmergencyShutdown();
        vm.prank(ALICE);
        vault.emergencyRedeem(WAD / 2, ALICE, _zeroes(2));
        assertEq(lossToken.balanceOf(ALICE), amounts[0] / 4);
        assertEq(soundToken.balanceOf(ALICE), amounts[1] / 2);
        assertEq(vault.accountedBalance(address(lossToken)), amounts[0] / 2);

        vm.prank(BOB);
        vault.emergencyRedeem(WAD / 2, BOB, _zeroes(2));
        assertEq(lossToken.balanceOf(BOB), amounts[0] / 4);
        assertEq(soundToken.balanceOf(BOB), amounts[1] / 2);
        assertEq(vault.accountedBalance(address(lossToken)), 0);
        assertEq(vault.accountedBalance(address(soundToken)), 0);
        assertEq(vault.totalSupply(), 0);
    }

    function testPermissionlessDeficitShutdownCheckpointsThenPermanentlyStopsFees() public {
        SlashableToken lossToken = new SlashableToken("Lossy", "LOSS", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(lossToken), address(tokenB), WAD, WAD, 1_000);
        _bootstrap(vault, router, _assets(address(lossToken), address(tokenB)), WAD);
        vm.warp(block.timestamp + 180 days);
        uint256 pendingAtShutdown = vault.pendingExpenseFeeShares();
        assertGt(pendingAtShutdown, 0);
        lossToken.slash(address(vault), 1);

        vm.prank(address(0xD1E7));
        vault.activateEmergencyShutdown();
        uint256 stoppedSupply = vault.totalSupply();
        assertEq(stoppedSupply, WAD + pendingAtShutdown);
        assertEq(vault.balanceOf(BENEFICIARY), 0);
        assertEq(vault.balanceOf(collector), pendingAtShutdown);
        assertTrue(vault.shutdown());
        assertEq(vault.shutdownAt(), block.timestamp);

        vm.warp(block.timestamp + 10 * 365 days);
        assertEq(vault.pendingExpenseFeeShares(), 0);
        assertEq(vault.checkpointFees(), 0);
        assertEq(vault.totalSupply(), stoppedSupply);
    }

    function testUnreadableAssetDoesNotHideSeparateProvenDeficit() public {
        SlashableToken unreadable = new SlashableToken("Unreadable", "UNREAD", 18);
        SlashableToken deficient = new SlashableToken("Deficient", "DEF", 18);
        SlashableToken sound = new SlashableToken("Sound", "SOUND", 18);
        address[] memory assets = new address[](3);
        assets[0] = address(unreadable);
        assets[1] = address(deficient);
        assets[2] = address(sound);
        uint256[] memory units = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            units[i] = WAD;
        }
        ManagedOTFVault vault = _createVault(factory, assets, units, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        for (uint256 i = 0; i < 3; i++) {
            SlashableToken(assets[i]).mint(address(router), amounts[i]);
            router.approveAsset(assets[i], address(vault), amounts[i]);
        }
        router.mint(vault, WAD, ALICE, amounts);

        unreadable.setBalanceReadsDisabled(true);
        deficient.slash(address(vault), 1);
        vm.prank(BOB);
        vault.activateEmergencyShutdown();

        assertTrue(vault.shutdown());
        assertEq(vault.shutdownAt(), block.timestamp);
    }

    function testUnreadableOnlyFailureNeedsCreatorAndCanBlockExit() public {
        SlashableToken unreadable = new SlashableToken("Unreadable", "UNREAD", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(unreadable), address(tokenB), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        unreadable.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(unreadable), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);

        unreadable.setBalanceReadsDisabled(true);
        vm.prank(BOB);
        vm.expectPartialRevert(ManagedOTFVaultStorage.UnauthorizedShutdown.selector);
        vault.activateEmergencyShutdown();

        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();
        vm.prank(ALICE);
        vm.expectRevert(SlashableToken.BalanceReadsDisabled.selector);
        vault.emergencyRedeem(WAD, ALICE, _zeroes(2));
    }

    function testFeeOnTransferAndRebasingConstituentsRevertByExactDeltas() public {
        MockFeeOnTransferToken taxed = new MockFeeOnTransferToken("Taxed", "TAX", 18);
        ManagedOTFVault taxedVault =
            _createTwoAssetVault(factory, address(taxed), address(tokenA), WAD, WAD, 0);
        uint256[] memory amounts = taxedVault.previewMint(WAD);
        taxed.mint(address(router), amounts[0]);
        tokenA.mint(address(router), amounts[1]);
        router.approveAsset(address(taxed), address(taxedVault), amounts[0]);
        router.approveAsset(address(tokenA), address(taxedVault), amounts[1]);
        taxed.setFeeBps(100);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        router.mint(taxedVault, WAD, ALICE, amounts);

        MockAdversarialERC20 rebasing = new MockAdversarialERC20("Rebasing", "REB", 18);
        ManagedOTFVault rebasingVault =
            _createTwoAssetVault(factory, address(rebasing), address(tokenB), WAD, WAD, 0);
        amounts = rebasingVault.previewMint(WAD);
        rebasing.mint(address(router), amounts[0] + 1);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(rebasing), address(rebasingVault), amounts[0]);
        router.approveAsset(address(tokenB), address(rebasingVault), amounts[1]);
        rebasing.setTransferMutation(MockAdversarialERC20.TransferMutation.TouchedBalanceRebase, 1);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        router.mint(rebasingVault, WAD, ALICE, amounts);
    }

    function testReentrantConstituentCallbackCannotEnterVault() public {
        MockReentrantToken reentrant = new MockReentrantToken("Reentrant", "RE", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(reentrant), address(tokenA), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        reentrant.mint(address(router), amounts[0]);
        tokenA.mint(address(router), amounts[1]);
        router.approveAsset(address(reentrant), address(vault), amounts[0]);
        router.approveAsset(address(tokenA), address(vault), amounts[1]);
        reentrant.configureCallback(
            address(vault), abi.encodeWithSelector(vault.checkpointFees.selector), true
        );

        router.mint(vault, WAD, ALICE, amounts);
        assertFalse(reentrant.callbackSucceeded());
        assertEq(vault.totalSupply(), WAD);
    }

    function testCrossTokenCallbackMutationRevertsTheWholeBasket() public {
        SlashableToken first = new SlashableToken("First", "FIRST", 18);
        CrossMutatingToken last = new CrossMutatingToken("Last", "LAST", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(first), address(last), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        first.mint(address(router), amounts[0]);
        last.mint(address(router), amounts[1]);
        router.approveAsset(address(first), address(vault), amounts[0]);
        router.approveAsset(address(last), address(vault), amounts[1]);
        last.configureCallback(
            address(first), abi.encodeWithSelector(first.slash.selector, address(vault), 1), true
        );

        vm.expectPartialRevert(ManagedOTFVaultStorage.BasketBalanceChanged.selector);
        router.mint(vault, WAD, ALICE, amounts);
        assertEq(first.balanceOf(address(vault)), 0);
        assertEq(last.balanceOf(address(vault)), 0);
        assertEq(vault.totalSupply(), 0);
    }

    function testEmergencyFinalBasketCheckRejectsLastTokenMutatingEarlierToken() public {
        SlashableToken first = new SlashableToken("First", "FIRST", 18);
        CrossMutatingToken last = new CrossMutatingToken("Last", "LAST", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(first), address(last), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        first.mint(address(router), amounts[0]);
        last.mint(address(router), amounts[1]);
        router.approveAsset(address(first), address(vault), amounts[0]);
        router.approveAsset(address(last), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);
        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();
        last.configureCallback(
            address(first), abi.encodeWithSelector(first.slash.selector, address(vault), 1), true
        );

        vm.prank(ALICE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.BasketBalanceChanged.selector);
        vault.emergencyRedeem(WAD / 2, ALICE, _zeroes(2));
        assertEq(first.balanceOf(address(vault)), amounts[0]);
        assertEq(last.balanceOf(address(vault)), amounts[1]);
        assertEq(vault.balanceOf(ALICE), WAD);
    }

    function testLastTokenCannotBurnEarlierAssetFromRedemptionReceiver() public {
        SlashableToken first = new SlashableToken("First", "FIRST", 18);
        CrossMutatingToken last = new CrossMutatingToken("Last", "LAST", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(first), address(last), WAD, WAD, 0);
        uint256[] memory amounts = vault.previewMint(2 * WAD);
        first.mint(address(router), amounts[0]);
        last.mint(address(router), amounts[1]);
        router.approveAsset(address(first), address(vault), amounts[0]);
        router.approveAsset(address(last), address(vault), amounts[1]);
        router.mint(vault, 2 * WAD, ALICE, amounts);
        last.configureCallback(
            address(first), abi.encodeWithSelector(first.slash.selector, ALICE, 1), true
        );
        vm.prank(ALICE);
        vault.approve(address(router), WAD);

        vm.expectPartialRevert(ManagedOTFVaultStorage.BasketAccountBalanceChanged.selector);
        router.redeem(vault, WAD, ALICE, ALICE, _zeroes(2));
        assertEq(first.balanceOf(ALICE), 0);
        assertEq(last.balanceOf(ALICE), 0);
        assertEq(vault.balanceOf(ALICE), 2 * WAD);
    }

    function testFeeResidualBelowMinimumShutsDownAndStopsFurtherFees() public {
        ManagedOTFVault vault = _newVault(23, 1_000);
        _bootstrap(vault, router, _assets(address(tokenA), address(tokenB)), WAD);
        vm.warp(block.timestamp + 1 days);

        uint256[] memory expected = vault.previewRedeem(WAD);
        assertGt(expected[0], 0);

        vm.prank(ALICE);
        vault.approve(address(router), WAD);
        router.redeem(vault, WAD, ALICE, ALICE, _zeroes(2));

        assertTrue(vault.shutdown());
        assertGt(vault.totalSupply(), 0);
        assertLt(vault.totalSupply(), 1e16);
        uint256 stoppedSupply = vault.totalSupply();
        vm.warp(block.timestamp + 10 * 365 days);
        assertEq(vault.pendingExpenseFeeShares(), 0);
        assertEq(vault.checkpointFees(), 0);
        assertEq(vault.totalSupply(), stoppedSupply);

        vm.expectPartialRevert(ManagedOTFVaultStorage.VaultShutdown.selector);
        router.mint(vault, 1, BOB, _zeroes(2));

        vm.prank(CREATOR);
        vm.expectPartialRevert(ManagedOTFVaultStorage.VaultShutdown.selector);
        vault.activateEmergencyShutdown();
    }

    function testNormalRedemptionLeavingExactlyMinimumSupplyStaysLive() public {
        ManagedOTFVault vault = _newVault(24, 0);
        _bootstrap(vault, router, _assets(address(tokenA), address(tokenB)), 2e16);
        vm.prank(ALICE);
        vault.approve(address(router), 1e16);

        router.redeem(vault, 1e16, ALICE, ALICE, _zeroes(2));

        assertEq(vault.totalSupply(), 1e16);
        assertFalse(vault.shutdown());
    }

    function testNormalRedemptionLeavingLessThanMinimumSucceedsAndShutsDown() public {
        ManagedOTFVault vault = _newVault(25, 0);
        _bootstrap(vault, router, _assets(address(tokenA), address(tokenB)), 2e16);
        vm.prank(ALICE);
        vault.approve(address(router), 1e16 + 1);

        router.redeem(vault, 1e16 + 1, ALICE, ALICE, _zeroes(2));

        assertEq(vault.totalSupply(), 1e16 - 1);
        assertTrue(vault.shutdown());
        assertEq(vault.shutdownAt(), block.timestamp);
    }

    function testFullRedemptionFromTwoMinimumUnitsSucceedsAndShutsDown() public {
        ManagedOTFVault vault = _newVault(26, 0);
        _bootstrap(vault, router, _assets(address(tokenA), address(tokenB)), 2e16);
        vm.prank(ALICE);
        vault.approve(address(router), 2e16);

        router.redeem(vault, 2e16, ALICE, ALICE, _zeroes(2));

        assertEq(vault.totalSupply(), 0);
        assertTrue(vault.shutdown());
        assertEq(vault.accountedBalance(address(tokenA)), 0);
        assertEq(vault.accountedBalance(address(tokenB)), 0);
    }

    function _newVault(uint256, uint16 expenseRatioBps) private returns (ManagedOTFVault) {
        return _createTwoAssetVault(
            factory, address(tokenA), address(tokenB), WAD, WAD, expenseRatioBps
        );
    }

    function _assets(address first, address second) private pure returns (address[] memory assets) {
        assets = new address[](2);
        assets[0] = first;
        assets[1] = second;
    }
}
