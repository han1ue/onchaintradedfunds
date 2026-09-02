// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    BasketMintRequest,
    BasketRedeemRequest,
    OTFEntryExitRouter,
    SwapLeg
} from "../src/OTFEntryExitRouter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";

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
            deadline: block.timestamp + 1
        });
    }

    function _nativeRedemptionLegs() private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = _leg(adapterA, address(assetA), address(weth), ONE, ONE);
        legs[1] = _leg(adapterB, address(assetB), address(weth), ONE, ONE);
    }
}
