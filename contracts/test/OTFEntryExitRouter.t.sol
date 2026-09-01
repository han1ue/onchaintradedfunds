// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BasketMintRequest, OTFEntryExitRouter, SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { MockTradeAdapter } from "./mocks/MockTradeAdapter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract OTFEntryExitRouterTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testMintSplitsOneInputAcrossTwoAdaptersAndRefundsEverySurplus() public {
        SwapLeg[] memory legs = new SwapLeg[](3);
        legs[0] = _leg(adapterA, address(input), address(assetC), 2 * ONE, 2 * ONE);
        legs[1] = _leg(adapterB, address(input), address(assetC), ONE, ONE);
        legs[2] = _leg(adapterA, address(input), address(assetD), ONE, ONE);

        uint256 inputBefore = input.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 shares, address[] memory refundTokens, uint256[] memory refundAmounts) =
            router.mintFromToken(_mintRequest(5 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(targetVault.balanceOf(ALICE), ONE);
        assertEq(input.balanceOf(ALICE), inputBefore - 4 * ONE);
        assertEq(assetC.balanceOf(ALICE), 2 * ONE);
        assertEq(refundTokens.length, 2);
        assertEq(refundTokens[0], address(input));
        assertEq(refundAmounts[0], ONE);
        assertEq(refundTokens[1], address(assetC));
        assertEq(refundAmounts[1], 2 * ONE);
        _assertRouterClean();
    }

    function testDifferentBackingAssetsUseDifferentAdapters() public {
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(input), address(assetC), ONE, ONE);
        legs[1] = _leg(adapterB, address(input), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        (uint256 shares, address[] memory refundTokens,) =
            router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(refundTokens.length, 0);
        _assertRouterClean();
    }

    function testEarlierAdapterOutputFundsLaterAdapter() public {
        SwapLeg[] memory legs = new SwapLeg[](3);
        legs[0] = _leg(adapterA, address(input), address(assetA), ONE, ONE);
        legs[1] = _leg(adapterB, address(assetA), address(assetC), type(uint256).max, ONE);
        legs[2] = _leg(adapterB, address(input), address(assetD), type(uint256).max, ONE);

        vm.prank(ALICE);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        _assertRouterClean();
    }

    function testMaxAmountSpendsOnlyCurrentTransientBalanceAndNotDust() public {
        input.mint(address(router), 7 * ONE);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(input), address(assetC), ONE, ONE);
        legs[1] = _leg(adapterB, address(input), address(assetD), type(uint256).max, ONE);

        vm.prank(ALICE);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(input.balanceOf(address(router)), 7 * ONE);
        assertEq(assetC.balanceOf(address(router)), 0);
        assertEq(assetD.balanceOf(address(router)), 0);
    }

    function testMixedAdapterRedemptionAndBasketConversion() public {
        SwapLeg[] memory redemption = new SwapLeg[](2);
        redemption[0] = _leg(adapterA, address(assetA), address(input), ONE, ONE);
        redemption[1] = _leg(adapterB, address(assetB), address(input), ONE, ONE);
        vm.prank(ALICE);
        (uint256 amountOut, address[] memory redeemRefunds,) =
            router.redeemToToken(_redeemRequest(ONE, 2 * ONE), _zeroMinimums(), redemption);
        assertEq(amountOut, 2 * ONE);
        assertEq(redeemRefunds.length, 0);

        SwapLeg[] memory conversion = new SwapLeg[](2);
        conversion[0] = _leg(adapterA, address(assetA), address(assetC), ONE, ONE);
        conversion[1] = _leg(adapterB, address(assetB), address(assetD), ONE, ONE);
        vm.prank(ALICE);
        (uint256 sharesOut, address[] memory conversionRefunds,) =
            router.swapBasketToBasket(_swapRequest(ONE, ONE), _zeroMinimums(), conversion);
        assertEq(sharesOut, ONE);
        assertEq(conversionRefunds.length, 0);
        _assertRouterClean();
    }

    function testUnapprovedRevokedZeroAndNoCodeAdaptersFailBeforeFundsMove() public {
        uint256 beforeBalance = input.balanceOf(ALICE);
        MockTradeAdapter unapproved = new MockTradeAdapter(address(router));
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(unapproved, address(input), address(assetC), ONE, ONE);
        legs[1] = _leg(adapterB, address(input), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.UnapprovedAdapter.selector, address(unapproved)
            )
        );
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);
        assertEq(input.balanceOf(ALICE), beforeBalance);

        router.setAdapterApproved(address(adapterA), false);
        legs[0] = _leg(adapterA, address(input), address(assetC), ONE, ONE);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.UnapprovedAdapter.selector, address(adapterA))
        );
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        legs[0].adapter = address(0);
        vm.prank(ALICE);
        vm.expectRevert(OTFEntryExitRouter.ZeroAddress.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        legs[0].adapter = BOB;
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(OTFEntryExitRouter.InvalidDependency.selector, BOB));
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);
        assertEq(input.balanceOf(ALICE), beforeBalance);
    }

    function testOnlyAdapterManagerCanMutateRegistryAndBindingIsChecked() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        router.setAdapterApproved(address(adapterA), false);

        MockTradeAdapter wrongRouter = new MockTradeAdapter(BOB);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.InvalidAdapterRouter.selector,
                address(wrongRouter),
                address(router),
                BOB
            )
        );
        router.setAdapterApproved(address(wrongRouter), true);
    }

    function testLyingOutputWrongInputUnderDeliveryReentrancyAndRevertRollback() public {
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(input), address(assetC), ONE, ONE);
        legs[1] = _leg(adapterB, address(input), address(assetD), ONE, ONE);
        uint256 beforeBalance = input.balanceOf(ALICE);

        adapterA.setBehavior(false, false, 1, 0);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapOutputMismatch.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);
        assertEq(input.balanceOf(ALICE), beforeBalance);

        adapterA.setBehavior(false, false, 0, 1);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapOutputMismatch.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        adapterA.setBehavior(false, true, 0, 0);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapInputMismatch.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        adapterA.setBehavior(false, false, 0, 0);
        adapterA.setReentrantCall(
            abi.encodeCall(
                OTFEntryExitRouter.mintFromToken, (_mintRequest(2 * ONE, ONE), new SwapLeg[](0))
            )
        );
        vm.prank(ALICE);
        vm.expectRevert(MockTradeAdapter.ReentrantCallFailed.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        adapterA.setReentrantCall("");
        adapterA.setBehavior(true, false, 0, 0);
        vm.prank(ALICE);
        vm.expectRevert(MockTradeAdapter.MockSwapFailed.selector);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(input.balanceOf(ALICE), beforeBalance);
        _assertRouterClean();
    }

    function testFactoryOtfCannotBeMintInputAndSwapDirectDoesNotExist() public {
        BasketMintRequest memory request = BasketMintRequest({
            inputToken: address(sourceVault),
            vault: address(targetVault),
            amountIn: ONE,
            minShares: ONE,
            deadline: block.timestamp + 1
        });
        vm.prank(ALICE);
        vm.expectRevert(OTFEntryExitRouter.InvalidRouteKind.selector);
        router.mintFromToken(request, new SwapLeg[](0));

        (bool success,) = address(router)
            .call(
                abi.encodeWithSignature(
                    "swapDirect((address,address,uint256,uint256,uint256),bytes)"
                )
            );
        assertFalse(success);
    }

    function testFortyOneLegsAreRejectedBeforeFundsMove() public {
        SwapLeg[] memory legs = new SwapLeg[](41);
        for (uint256 i = 0; i < legs.length; i++) {
            legs[i] = _leg(adapterA, address(input), address(assetC), 1, 1);
        }
        uint256 beforeBalance = input.balanceOf(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(OTFEntryExitRouter.TooManyLegs.selector, 41, 40));
        router.mintFromToken(_mintRequest(ONE, ONE), legs);
        assertEq(input.balanceOf(ALICE), beforeBalance);
    }
}
