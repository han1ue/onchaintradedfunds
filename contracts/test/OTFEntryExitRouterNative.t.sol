// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    BasketMintRequest,
    BasketRedeemRequest,
    OTFEntryExitRouter,
    SwapLeg
} from "../src/OTFEntryExitRouter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { MockOTFSettlementVault } from "./mocks/MockOTFSettlement.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";

contract NativeReceiver {
    OTFEntryExitRouter private immutable _router;
    bytes private _reentryData;
    bool public rejectNative;
    bool public reentryRejected;

    constructor(OTFEntryExitRouter router_) {
        _router = router_;
    }

    function configure(bool rejectNative_, bytes calldata reentryData_) external {
        rejectNative = rejectNative_;
        _reentryData = reentryData_;
    }

    function approveShares(address vault, uint256 amount) external {
        (bool success,) =
            vault.call(abi.encodeWithSignature("approve(address,uint256)", _router, amount));
        require(success, "APPROVE_FAILED");
    }

    function mint(BasketMintRequest calldata request, SwapLeg[] calldata legs)
        external
        payable
        returns (
            uint256 shares,
            address[] memory refundTokens,
            uint256[] memory refundAmounts,
            uint256 nativeRefunded
        )
    {
        return _router.mintFromNative{ value: msg.value }(request, legs);
    }

    function redeem(
        BasketRedeemRequest calldata request,
        uint256[] calldata minimums,
        SwapLeg[] calldata legs
    ) external {
        _router.redeemToNative(request, minimums, legs);
    }

    receive() external payable {
        if (rejectNative) revert("REJECT_NATIVE");
        if (_reentryData.length != 0) {
            (bool success, bytes memory result) = address(_router).call(_reentryData);
            bytes4 selector;
            if (result.length >= 4) {
                assembly ("memory-safe") {
                    selector := mload(add(result, 0x20))
                }
            }
            require(
                !success && selector == OTFEntryExitRouter.Reentrancy.selector,
                "REENTRY_NOT_REJECTED"
            );
            reentryRejected = true;
        }
    }
}

contract OTFEntryExitRouterNativeTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
        vm.deal(ALICE, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function testNativeMintWrapsExactInputAndRefundsNativeAndErc20Residuals() public {
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(weth), address(assetC), 2 * ONE, 2 * ONE);
        legs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);
        BasketMintRequest memory request = _nativeMintRequest(4 * ONE, ONE);
        uint256 beforeBalance = ALICE.balance;

        vm.prank(ALICE);
        (
            uint256 shares,
            address[] memory refundTokens,
            uint256[] memory refundAmounts,
            uint256 nativeRefunded
        ) = router.mintFromNative{ value: 4 * ONE }(request, legs);

        assertEq(shares, ONE);
        assertEq(targetVault.balanceOf(ALICE), ONE);
        assertEq(nativeRefunded, ONE);
        assertEq(ALICE.balance, beforeBalance - 3 * ONE);
        assertEq(refundTokens.length, 1);
        assertEq(refundTokens[0], address(assetC));
        assertEq(refundAmounts[0], ONE);
        _assertRouterClean();
        assertEq(address(router).balance, 0);
    }

    function testNativeRedeemUnwrapsExactTransientWeth() public {
        SwapLeg[] memory legs = _nativeRedemptionLegs();
        uint256 beforeBalance = ALICE.balance;

        vm.prank(ALICE);
        (uint256 amountOut, address[] memory refunds,) =
            router.redeemToNative(_nativeRedeemRequest(ALICE, ONE, 2 * ONE), _zeroMinimums(), legs);

        assertEq(amountOut, 2 * ONE);
        assertEq(ALICE.balance, beforeBalance + 2 * ONE);
        assertEq(refunds.length, 0);
        _assertRouterClean();
        assertEq(address(router).balance, 0);
    }

    function testTokenAndNativeMintsShareBasketProcessingWithDistinctFunding() public {
        SwapLeg[] memory tokenLegs = new SwapLeg[](2);
        tokenLegs[0] = _leg(adapterA, address(input), address(assetC), ONE, ONE);
        tokenLegs[1] = _leg(adapterB, address(input), address(assetD), ONE, ONE);
        SwapLeg[] memory nativeLegs = new SwapLeg[](2);
        nativeLegs[0] = _leg(adapterA, address(weth), address(assetC), ONE, ONE);
        nativeLegs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);
        uint256 inputBefore = input.balanceOf(ALICE);
        uint256 nativeBefore = ALICE.balance;

        vm.prank(ALICE);
        router.mintFromToken(_mintRequest(2 * ONE, ONE), tokenLegs);

        assertEq(targetVault.checkpointCalls(), 1);
        assertEq(targetVault.routerMintCalls(), 1);
        assertEq(input.balanceOf(ALICE), inputBefore - 2 * ONE);
        assertEq(ALICE.balance, nativeBefore);

        vm.prank(ALICE);
        router.mintFromNative{ value: 2 * ONE }(_nativeMintRequest(2 * ONE, ONE), nativeLegs);

        assertEq(targetVault.checkpointCalls(), 2);
        assertEq(targetVault.routerMintCalls(), 2);
        assertEq(targetVault.balanceOf(ALICE), 2 * ONE);
        assertEq(input.balanceOf(ALICE), inputBefore - 2 * ONE);
        assertEq(ALICE.balance, nativeBefore - 2 * ONE);
        _assertRouterClean();
    }

    function testTokenAndNativeRedeemsShareBasketProcessingWithDistinctPayouts() public {
        SwapLeg[] memory tokenLegs = new SwapLeg[](2);
        tokenLegs[0] = _leg(adapterA, address(assetA), address(input), ONE, ONE);
        tokenLegs[1] = _leg(adapterB, address(assetB), address(input), ONE, ONE);
        uint256 inputBefore = input.balanceOf(ALICE);
        uint256 nativeBefore = ALICE.balance;

        vm.prank(ALICE);
        router.redeemToToken(_redeemRequest(ONE, 2 * ONE), _zeroMinimums(), tokenLegs);

        assertEq(sourceVault.checkpointCalls(), 1);
        assertEq(sourceVault.routerRedeemCalls(), 1);
        assertEq(input.balanceOf(ALICE), inputBefore + 2 * ONE);
        assertEq(ALICE.balance, nativeBefore);

        vm.prank(ALICE);
        router.redeemToNative(
            _nativeRedeemRequest(ALICE, ONE, 2 * ONE), _zeroMinimums(), _nativeRedemptionLegs()
        );

        assertEq(sourceVault.checkpointCalls(), 2);
        assertEq(sourceVault.routerRedeemCalls(), 2);
        assertEq(input.balanceOf(ALICE), inputBefore + 2 * ONE);
        assertEq(ALICE.balance, nativeBefore + 2 * ONE);
        _assertRouterClean();
    }

    function testNativeMintEnforcesExactNonzeroValueAndCanonicalWeth() public {
        BasketMintRequest memory request = _nativeMintRequest(2 * ONE, ONE);
        SwapLeg[] memory legs = new SwapLeg[](0);
        vm.startPrank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.InvalidNativeValue.selector, 2 * ONE, ONE)
        );
        router.mintFromNative{ value: ONE }(request, legs);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.InvalidNativeValue.selector, 2 * ONE, 3 * ONE)
        );
        router.mintFromNative{ value: 3 * ONE }(request, legs);
        request.amountIn = 0;
        vm.expectRevert(OTFEntryExitRouter.InvalidAmount.selector);
        router.mintFromNative(request, legs);
        request.amountIn = ONE;
        request.inputToken = address(input);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.InvalidNativeEndpoint.selector, address(input)
            )
        );
        router.mintFromNative{ value: ONE }(request, legs);
        vm.stopPrank();
    }

    function testNativeOperationsPreservePreexistingEthAndWeth() public {
        vm.deal(address(router), 7 * ONE);
        weth.mint(address(router), 5 * ONE);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(weth), address(assetC), ONE, ONE);
        legs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        router.mintFromNative{ value: 2 * ONE }(_nativeMintRequest(2 * ONE, ONE), legs);

        assertEq(address(router).balance, 7 * ONE);
        assertEq(weth.balanceOf(address(router)), 5 * ONE);
        assertEq(assetC.balanceOf(address(router)), 0);
        assertEq(assetD.balanceOf(address(router)), 0);
    }

    function testUnsolicitedEthAndNativeMarkersInLegsAreRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.UnexpectedNativeSender.selector, ALICE)
        );
        (bool success,) = address(router).call{ value: ONE }("");
        success;

        SwapLeg[] memory legs = new SwapLeg[](1);
        legs[0] = _leg(adapterA, address(0), address(assetC), ONE, ONE);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.ForbiddenRouteToken.selector, address(0))
        );
        router.mintFromNative{ value: ONE }(_nativeMintRequest(ONE, ONE), legs);
    }

    function testRejectingReceiverAndAdapterFailureRollbackAtomically() public {
        NativeReceiver receiver = new NativeReceiver(router);
        sourceVault.seedShares(address(receiver), ONE);
        receiver.approveShares(address(sourceVault), ONE);
        receiver.configure(true, "");
        uint256 sharesBefore = sourceVault.balanceOf(address(receiver));
        vm.expectPartialRevert(OTFEntryExitRouter.NativeTransferFailed.selector);
        receiver.redeem(
            _nativeRedeemRequest(address(receiver), ONE, 2 * ONE),
            _zeroMinimums(),
            _nativeRedemptionLegs()
        );
        assertEq(sourceVault.balanceOf(address(receiver)), sharesBefore);

        SwapLeg[] memory mintLegs = new SwapLeg[](2);
        mintLegs[0] = _leg(adapterA, address(weth), address(assetC), ONE, ONE);
        mintLegs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);
        adapterA.setBehavior(true, false, 0, 0);
        uint256 nativeBefore = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert();
        router.mintFromNative{ value: 2 * ONE }(_nativeMintRequest(2 * ONE, ONE), mintLegs);
        assertEq(ALICE.balance, nativeBefore);
        assertEq(targetVault.balanceOf(ALICE), 0);
    }

    function testNativeRefundCallbackCannotReenter() public {
        NativeReceiver receiver = new NativeReceiver(router);
        sourceVault.seedShares(address(receiver), ONE);
        receiver.approveShares(address(sourceVault), ONE);
        BasketMintRequest memory reentry = _nativeMintRequest(ONE, ONE);
        receiver.configure(
            false, abi.encodeCall(OTFEntryExitRouter.mintFromNative, (reentry, new SwapLeg[](0)))
        );

        receiver.redeem(
            _nativeRedeemRequest(address(receiver), ONE, 2 * ONE),
            _zeroMinimums(),
            _nativeRedemptionLegs()
        );

        assertTrue(receiver.reentryRejected());
        assertEq(address(receiver).balance, 2 * ONE);
    }

    function testRejectingNativeMintRefundRollsBackAtomically() public {
        NativeReceiver receiver = new NativeReceiver(router);
        vm.deal(address(receiver), 10 * ONE);
        receiver.configure(true, "");
        SwapLeg[] memory legs = _nativeMintRefundLegs();
        uint256 senderNativeBefore = address(this).balance;
        uint256 receiverNativeBefore = address(receiver).balance;
        uint256 wethNativeBefore = address(weth).balance;
        uint256 adapterAWethBefore = weth.balanceOf(address(adapterA));
        uint256 adapterBWethBefore = weth.balanceOf(address(adapterB));
        uint256 adapterAAssetBefore = assetC.balanceOf(address(adapterA));
        uint256 adapterBAssetBefore = assetD.balanceOf(address(adapterB));

        vm.expectPartialRevert(OTFEntryExitRouter.NativeTransferFailed.selector);
        receiver.mint{ value: 4 * ONE }(_nativeMintRequest(4 * ONE, ONE), legs);

        assertEq(address(this).balance, senderNativeBefore);
        assertEq(address(receiver).balance, receiverNativeBefore);
        assertEq(address(weth).balance, wethNativeBefore);
        assertEq(targetVault.totalSupply(), 0);
        assertEq(targetVault.balanceOf(address(receiver)), 0);
        assertEq(assetC.balanceOf(address(targetVault)), 0);
        assertEq(assetD.balanceOf(address(targetVault)), 0);
        assertEq(targetVault.checkpointCalls(), 0);
        assertEq(targetVault.routerMintCalls(), 0);
        assertEq(weth.balanceOf(address(adapterA)), adapterAWethBefore);
        assertEq(weth.balanceOf(address(adapterB)), adapterBWethBefore);
        assertEq(assetC.balanceOf(address(adapterA)), adapterAAssetBefore);
        assertEq(assetD.balanceOf(address(adapterB)), adapterBAssetBefore);
        assertEq(assetC.balanceOf(address(receiver)), 0);
        assertEq(assetD.balanceOf(address(receiver)), 0);
        assertEq(weth.allowance(address(router), address(adapterA)), 0);
        assertEq(weth.allowance(address(router), address(adapterB)), 0);
        _assertRouterClean();
        assertEq(address(router).balance, 0);
    }

    function testNativeMintRefundReentrancyIsRejectedAndOuterMintCompletes() public {
        NativeReceiver receiver = new NativeReceiver(router);
        vm.deal(address(receiver), 10 * ONE);
        BasketMintRequest memory reentry = _nativeMintRequest(ONE, ONE);
        receiver.configure(
            false, abi.encodeCall(OTFEntryExitRouter.mintFromNative, (reentry, new SwapLeg[](0)))
        );
        uint256 receiverNativeBefore = address(receiver).balance;
        uint256 wethNativeBefore = address(weth).balance;

        (
            uint256 shares,
            address[] memory refundTokens,
            uint256[] memory refundAmounts,
            uint256 nativeRefunded
        ) = receiver.mint{ value: 4 * ONE }(
            _nativeMintRequest(4 * ONE, ONE), _nativeMintRefundLegs()
        );

        assertEq(shares, ONE);
        assertEq(nativeRefunded, ONE);
        assertEq(refundTokens.length, 1);
        assertEq(refundTokens[0], address(assetC));
        assertEq(refundAmounts[0], ONE);
        assertTrue(receiver.reentryRejected());
        assertEq(address(receiver).balance, receiverNativeBefore + ONE);
        assertEq(address(weth).balance, wethNativeBefore + 3 * ONE);
        assertEq(targetVault.totalSupply(), ONE);
        assertEq(targetVault.balanceOf(address(receiver)), ONE);
        assertEq(assetC.balanceOf(address(receiver)), ONE);
        assertEq(assetC.balanceOf(address(targetVault)), ONE);
        assertEq(assetD.balanceOf(address(targetVault)), ONE);
        assertEq(targetVault.checkpointCalls(), 1);
        assertEq(targetVault.routerMintCalls(), 1);
        assertEq(weth.allowance(address(router), address(adapterA)), 0);
        assertEq(weth.allowance(address(router), address(adapterB)), 0);
        _assertRouterClean();
        assertEq(address(router).balance, 0);
    }

    function testNativeMintSecondResidualPassRejectsReintroducedWethAndRollsBack() public {
        MockReentrantToken callbackAsset = new MockReentrantToken("Callback Asset", "CALL", 18);
        address[] memory targetAssets = new address[](2);
        targetAssets[0] = address(callbackAsset);
        targetAssets[1] = address(assetD);
        targetVault = new MockOTFSettlementVault("Callback OTF", "CB", targetAssets);
        protocolFactory.setVault(address(targetVault), true);
        targetVault.setRouter(address(router));
        callbackAsset.mint(address(adapterA), 1_000_000 * ONE);
        adapterA.setRate(address(weth), address(callbackAsset), 1, 1);
        weth.mint(address(callbackAsset), ONE);
        callbackAsset.configureCallback(
            address(weth), abi.encodeCall(weth.transfer, (address(router), ONE)), true
        );
        callbackAsset.configureCallbackSender(address(router));

        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(weth), address(callbackAsset), 2 * ONE, 2 * ONE);
        legs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);
        uint256 nativeBefore = ALICE.balance;
        uint256 wethNativeBefore = address(weth).balance;
        uint256 callbackWethBefore = weth.balanceOf(address(callbackAsset));
        uint256 adapterAWethBefore = weth.balanceOf(address(adapterA));
        uint256 adapterBWethBefore = weth.balanceOf(address(adapterB));
        uint256 adapterACallbackBefore = callbackAsset.balanceOf(address(adapterA));
        uint256 adapterBAssetBefore = assetD.balanceOf(address(adapterB));

        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.ResidualBalance.selector);
        router.mintFromNative{ value: 4 * ONE }(_nativeMintRequest(4 * ONE, ONE), legs);

        assertEq(ALICE.balance, nativeBefore);
        assertEq(address(weth).balance, wethNativeBefore);
        assertEq(weth.balanceOf(address(callbackAsset)), callbackWethBefore);
        assertEq(targetVault.totalSupply(), 0);
        assertEq(targetVault.balanceOf(ALICE), 0);
        assertEq(callbackAsset.balanceOf(address(targetVault)), 0);
        assertEq(assetD.balanceOf(address(targetVault)), 0);
        assertEq(targetVault.checkpointCalls(), 0);
        assertEq(targetVault.routerMintCalls(), 0);
        assertEq(weth.balanceOf(address(adapterA)), adapterAWethBefore);
        assertEq(weth.balanceOf(address(adapterB)), adapterBWethBefore);
        assertEq(callbackAsset.balanceOf(address(adapterA)), adapterACallbackBefore);
        assertEq(assetD.balanceOf(address(adapterB)), adapterBAssetBefore);
        assertEq(weth.allowance(address(router), address(adapterA)), 0);
        assertEq(weth.allowance(address(router), address(adapterB)), 0);
        _assertRouterClean();
        assertEq(callbackAsset.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
    }

    function _nativeMintRequest(uint256 amountIn, uint256 minShares)
        private
        view
        returns (BasketMintRequest memory)
    {
        return BasketMintRequest({
            inputToken: address(weth),
            vault: address(targetVault),
            amountIn: amountIn,
            minShares: minShares,
            deadline: block.timestamp + 1
        });
    }

    function _nativeRedeemRequest(address, uint256 shares, uint256 minAmountOut)
        private
        view
        returns (BasketRedeemRequest memory)
    {
        return BasketRedeemRequest({
            vault: address(sourceVault),
            outputToken: address(weth),
            shares: shares,
            minAmountOut: minAmountOut,
            skipMask: 0,
            deadline: block.timestamp + 1
        });
    }

    function _nativeRedemptionLegs() private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(assetA), address(weth), ONE, ONE);
        legs[1] = _leg(adapterB, address(assetB), address(weth), ONE, ONE);
    }

    function _nativeMintRefundLegs() private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(weth), address(assetC), 2 * ONE, 2 * ONE);
        legs[1] = _leg(adapterB, address(weth), address(assetD), ONE, ONE);
    }
}
