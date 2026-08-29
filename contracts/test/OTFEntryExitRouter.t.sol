// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    BasketMintRequest,
    BasketRedeemRequest,
    BasketSwapRequest,
    DirectSwapRequest,
    OTFEntryExitRouter,
    V3Swap
} from "../src/OTFEntryExitRouter.sol";
import { MockAdversarialERC20 } from "./mocks/MockAdversarialERC20.sol";
import { MockFeeOnTransferToken } from "./mocks/MockFeeOnTransferToken.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { MockOTFSettlementVault } from "./mocks/MockOTFSettlement.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { Vm } from "./TestBase.sol";

contract OTFEntryExitRouterTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testBasketBuySellAndCrossOTFAreAtomicAndConservative() public {
        V3Swap[] memory buyLegs = new V3Swap[](2);
        buyLegs[0] = _leg(address(input), address(assetC), 50 * ONE, 50 * ONE);
        buyLegs[1] = _leg(address(input), address(assetD), 50 * ONE, 50 * ONE);
        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));

        vm.startPrank(ALICE);
        input.approve(address(router), 100 * ONE);
        (uint256 bought, uint256 refunded) = router.mintFromToken(
            BasketMintRequest({
                inputToken: address(input),
                vault: address(targetVault),
                amountIn: 100 * ONE,
                minShares: 50 * ONE,
                deadline: block.timestamp + 1
            }),
            buyLegs
        );
        assertEq(bought, 50 * ONE);
        assertEq(refunded, 0);

        targetVault.approve(address(router), 50 * ONE);
        V3Swap[] memory sellLegs = new V3Swap[](2);
        sellLegs[0] = _leg(address(assetC), address(input), type(uint256).max, 50 * ONE);
        sellLegs[1] = _leg(address(assetD), address(input), type(uint256).max, 50 * ONE);
        uint256 sold = router.redeemToToken(
            BasketRedeemRequest({
                vault: address(targetVault),
                outputToken: address(input),
                shares: 50 * ONE,
                minAmountOut: 100 * ONE,
                deadline: block.timestamp + 1
            }),
            _zeroMinimums(),
            sellLegs
        );
        assertEq(sold, 100 * ONE);

        sourceVault.approve(address(router), 40 * ONE);
        V3Swap[] memory crossLegs = new V3Swap[](2);
        crossLegs[0] = _leg(address(assetA), address(assetC), type(uint256).max, 40 * ONE);
        crossLegs[1] = _leg(address(assetB), address(assetD), type(uint256).max, 40 * ONE);
        uint256 crossOut = router.swapBasketToBasket(
            BasketSwapRequest({
                sourceVault: address(sourceVault),
                targetVault: address(targetVault),
                sharesIn: 40 * ONE,
                minSharesOut: 40 * ONE,
                deadline: block.timestamp + 1
            }),
            _zeroMinimums(),
            crossLegs
        );
        vm.stopPrank();

        assertEq(crossOut, 40 * ONE);
        _assertRouterClean();
    }

    function testUnusedInputAndNonLimitingBasketAssetsAreRefundedOnlyToCaller() public {
        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(input), address(assetC), 70 * ONE, 70 * ONE);
        legs[1] = _leg(address(input), address(assetD), 50 * ONE, 50 * ONE);
        uint256 cBefore = assetC.balanceOf(ALICE);

        vm.startPrank(ALICE);
        input.approve(address(router), 150 * ONE);
        (uint256 shares, uint256 inputRefunded) = router.mintFromToken(
            BasketMintRequest({
                inputToken: address(input),
                vault: address(targetVault),
                amountIn: 150 * ONE,
                minShares: 50 * ONE,
                deadline: block.timestamp + 1
            }),
            legs
        );
        vm.stopPrank();

        assertEq(shares, 50 * ONE);
        assertEq(inputRefunded, 30 * ONE);
        assertEq(assetC.balanceOf(ALICE) - cBefore, 20 * ONE);
        assertEq(targetVault.balanceOf(ALICE), 50 * ONE);
        assertEq(assetC.balanceOf(BOB), 0);
        _assertRouterClean();
    }

    function testLegFailureAndTargetMintFailureRollbackAllState() public {
        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(input), address(assetC), 50 * ONE, 50 * ONE);
        legs[1] = _leg(address(input), address(assetD), 50 * ONE, 50 * ONE);
        uint256 inputBefore = input.balanceOf(ALICE);

        venue.setFailNextSwap(true);
        vm.startPrank(ALICE);
        input.approve(address(router), 100 * ONE);
        vm.expectRevert(bytes("LEG_FAILED"));
        router.mintFromToken(_buyRequest(50 * ONE), legs);
        vm.stopPrank();
        assertEq(input.balanceOf(ALICE), inputBefore);
        assertEq(targetVault.balanceOf(ALICE), 0);

        venue.setFailNextSwap(false);
        targetVault.setFailure(true, false);
        vm.startPrank(ALICE);
        input.approve(address(router), 0);
        input.approve(address(router), 100 * ONE);
        vm.expectRevert(bytes("MINT_FAILED"));
        router.mintFromToken(_buyRequest(50 * ONE), legs);
        vm.stopPrank();
        assertEq(input.balanceOf(ALICE), inputBefore);
        assertEq(targetVault.balanceOf(ALICE), 0);
        _assertRouterClean();
    }

    function testDeadlineSlippageAndRouteDiscontinuityRollback() public {
        V3Swap[] memory direct = new V3Swap[](1);
        direct[0] = _leg(address(input), address(sourceVault), 10 * ONE, 10 * ONE);
        uint256 beforeBalance = input.balanceOf(ALICE);

        vm.startPrank(ALICE);
        input.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.DeadlineExpired.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(input),
                tokenOut: address(sourceVault),
                amountIn: 10 * ONE,
                minAmountOut: 10 * ONE,
                deadline: block.timestamp - 1
            }),
            direct
        );

        vm.expectRevert(bytes("SLIPPAGE"));
        direct[0].minAmountOut = 11 * ONE;
        router.swapDirect(_directBuyRequest(10 * ONE, 10 * ONE), direct);

        V3Swap[] memory discontinuous = new V3Swap[](2);
        discontinuous[0] = _leg(address(input), address(assetA), 5 * ONE, 5 * ONE);
        discontinuous[1] = _leg(address(assetB), address(sourceVault), 5 * ONE, 5 * ONE);
        _createPool(address(assetB), address(sourceVault));
        vm.expectPartialRevert(OTFEntryExitRouter.InsufficientRouteBalance.selector);
        router.swapDirect(_directBuyRequest(10 * ONE, 1), discontinuous);
        vm.stopPrank();

        assertEq(input.balanceOf(ALICE), beforeBalance);
        _assertRouterClean();
    }

    function testDirectSwapEventRecordsGrossInputAndPartialInputRefund() public {
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(input), address(sourceVault), 10 * ONE, 10 * ONE);

        vm.startPrank(ALICE);
        input.approve(address(router), 20 * ONE);
        vm.recordLogs();
        router.swapDirect(_directBuyRequest(20 * ONE, 10 * ONE), legs);
        vm.stopPrank();

        (uint256 grossAmountIn, uint256 inputRefunded, uint256 amountOut) =
            _directSwapEventAmounts(vm.getRecordedLogs());
        assertEq(grossAmountIn, 20 * ONE);
        assertEq(inputRefunded, 10 * ONE);
        assertEq(amountOut, 10 * ONE);
        _assertRouterClean();
    }

    function testDirectSwapEventSupportsRefundGreaterThanGrossInput() public {
        venue.setOutputMultiplier(2);
        V3Swap[] memory legs = new V3Swap[](3);
        legs[0] = _leg(address(input), address(assetC), 10 * ONE, 20 * ONE);
        legs[1] = _leg(address(assetC), address(input), 20 * ONE, 40 * ONE);
        legs[2] = _leg(address(input), address(sourceVault), 5 * ONE, 10 * ONE);
        _createPool(address(input), address(assetC));

        vm.startPrank(ALICE);
        input.approve(address(router), 10 * ONE);
        vm.recordLogs();
        router.swapDirect(_directBuyRequest(10 * ONE, 10 * ONE), legs);
        vm.stopPrank();

        (uint256 grossAmountIn, uint256 inputRefunded, uint256 amountOut) =
            _directSwapEventAmounts(vm.getRecordedLogs());
        assertEq(grossAmountIn, 10 * ONE);
        assertEq(inputRefunded, 35 * ONE);
        assertEq(amountOut, 10 * ONE);
        _assertRouterClean();
    }

    function testFeeOnTransferAndBalanceMutatingInputsAreRejected() public {
        MockFeeOnTransferToken taxed = new MockFeeOnTransferToken("Taxed", "TAX", 18);
        taxed.mint(ALICE, 100 * ONE);
        taxed.setFeeBps(100);
        _createPool(address(taxed), address(sourceVault));
        V3Swap[] memory taxedLeg = new V3Swap[](1);
        taxedLeg[0] = _leg(address(taxed), address(sourceVault), 10 * ONE, 1);

        vm.startPrank(ALICE);
        taxed.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.TokenTransferMismatch.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(taxed),
                tokenOut: address(sourceVault),
                amountIn: 10 * ONE,
                minAmountOut: 1,
                deadline: block.timestamp + 1
            }),
            taxedLeg
        );
        vm.stopPrank();

        taxed.mint(address(venue), 100 * ONE);
        V3Swap[] memory taxedOutputLeg = new V3Swap[](1);
        taxedOutputLeg[0] = _leg(address(sourceVault), address(taxed), 10 * ONE, 1);
        vm.startPrank(ALICE);
        sourceVault.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapOutputMismatch.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(sourceVault),
                tokenOut: address(taxed),
                amountIn: 10 * ONE,
                minAmountOut: 1,
                deadline: block.timestamp + 1
            }),
            taxedOutputLeg
        );
        vm.stopPrank();

        MockAdversarialERC20 rebasing = new MockAdversarialERC20("Rebase", "REB", 18);
        rebasing.mint(ALICE, 100 * ONE);
        rebasing.setTransferMutation(
            MockAdversarialERC20.TransferMutation.TouchedBalanceRebase, ONE
        );
        _createPool(address(rebasing), address(sourceVault));
        V3Swap[] memory rebaseLeg = new V3Swap[](1);
        rebaseLeg[0] = _leg(address(rebasing), address(sourceVault), 10 * ONE, 1);
        vm.startPrank(ALICE);
        rebasing.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.TokenTransferMismatch.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(rebasing),
                tokenOut: address(sourceVault),
                amountIn: 10 * ONE,
                minAmountOut: 1,
                deadline: block.timestamp + 1
            }),
            rebaseLeg
        );
        vm.stopPrank();
    }

    function testTokenThatLiesAboutApprovalIsRejectedBeforeVenueCall() public {
        MockAdversarialERC20 liar = new MockAdversarialERC20("Liar", "LIE", 18);
        liar.mint(ALICE, 10 * ONE);
        _createPool(address(liar), address(sourceVault));
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(liar), address(sourceVault), 10 * ONE, 1);

        vm.prank(ALICE);
        liar.approve(address(router), 10 * ONE);
        liar.setIgnoreApprovals(true);
        vm.prank(ALICE);
        vm.expectPartialRevert(OTFEntryExitRouter.ApprovalMismatch.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(liar),
                tokenOut: address(sourceVault),
                amountIn: 10 * ONE,
                minAmountOut: 1,
                deadline: block.timestamp + 1
            }),
            legs
        );

        assertEq(liar.balanceOf(ALICE), 10 * ONE);
        assertEq(liar.balanceOf(address(router)), 0);
        assertEq(liar.allowance(address(router), address(venue)), 0);
    }

    function testTokenCallbackCannotReenterAndOuterSwapRemainsExact() public {
        MockReentrantToken callbackToken = new MockReentrantToken("Callback", "CB", 18);
        callbackToken.mint(ALICE, 10 * ONE);
        callbackToken.mint(address(venue), 100 * ONE);
        _createPool(address(callbackToken), address(sourceVault));
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(callbackToken), address(sourceVault), 10 * ONE, 10 * ONE);

        bytes memory nested = abi.encodeCall(
            router.swapDirect,
            (
                DirectSwapRequest({
                    tokenIn: address(callbackToken),
                    tokenOut: address(sourceVault),
                    amountIn: 1,
                    minAmountOut: 1,
                    deadline: block.timestamp + 1
                }),
                legs
            )
        );
        callbackToken.configureCallback(address(router), nested, true);

        vm.startPrank(ALICE);
        callbackToken.approve(address(router), 10 * ONE);
        assertEq(
            router.swapDirect(
                DirectSwapRequest({
                    tokenIn: address(callbackToken),
                    tokenOut: address(sourceVault),
                    amountIn: 10 * ONE,
                    minAmountOut: 10 * ONE,
                    deadline: block.timestamp + 1
                }),
                legs
            ),
            10 * ONE
        );
        vm.stopPrank();

        assertFalse(callbackToken.callbackSucceeded());
        assertEq(callbackToken.balanceOf(address(router)), 0);
        assertEq(callbackToken.allowance(address(router), address(venue)), 0);
    }

    function testLateRefundCallbackCannotMutateAnAlreadyClosedToken() public {
        MockReentrantToken callbackToken = new MockReentrantToken("Callback", "CB", 18);
        callbackToken.mint(address(venue), 10 * ONE);
        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));
        _createPool(address(input), address(callbackToken));
        callbackToken.configureCallback(
            address(input), abi.encodeCall(input.mint, (address(router), ONE)), true
        );
        callbackToken.configureCallbackSender(address(router));

        V3Swap[] memory legs = new V3Swap[](3);
        legs[0] = _leg(address(input), address(assetC), 50 * ONE, 50 * ONE);
        legs[1] = _leg(address(input), address(assetD), 50 * ONE, 50 * ONE);
        legs[2] = _leg(address(input), address(callbackToken), ONE, ONE);
        uint256 beforeInput = input.balanceOf(ALICE);

        vm.startPrank(ALICE);
        input.approve(address(router), 101 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.ResidualBalance.selector);
        router.mintFromToken(
            BasketMintRequest({
                inputToken: address(input),
                vault: address(targetVault),
                amountIn: 101 * ONE,
                minShares: 50 * ONE,
                deadline: block.timestamp + 1
            }),
            legs
        );
        vm.stopPrank();

        assertEq(input.balanceOf(ALICE), beforeInput);
        assertEq(input.balanceOf(address(router)), 0);
        assertEq(callbackToken.balanceOf(address(router)), 0);
        assertEq(targetVault.balanceOf(ALICE), 0);
    }

    function testLateRefundCallbackCannotReduceEarlierCallerOutput() public {
        MockAdversarialERC20 output = new MockAdversarialERC20("Output", "OUT", 18);
        MockReentrantToken callbackToken = new MockReentrantToken("Callback", "CB", 18);
        output.mint(address(venue), 100 * ONE);
        callbackToken.mint(address(venue), 10 * ONE);
        _createPool(address(sourceVault), address(output));
        _createPool(address(sourceVault), address(callbackToken));
        callbackToken.configureCallback(
            address(output), abi.encodeCall(output.burn, (ALICE, ONE)), true
        );
        callbackToken.configureCallbackSender(address(router));

        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(sourceVault), address(output), 10 * ONE, 10 * ONE);
        legs[1] = _leg(address(sourceVault), address(callbackToken), ONE, ONE);
        uint256 sharesBefore = sourceVault.balanceOf(ALICE);

        vm.startPrank(ALICE);
        sourceVault.approve(address(router), 11 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.CallerBalanceMismatch.selector);
        router.swapDirect(
            DirectSwapRequest({
                tokenIn: address(sourceVault),
                tokenOut: address(output),
                amountIn: 11 * ONE,
                minAmountOut: 10 * ONE,
                deadline: block.timestamp + 1
            }),
            legs
        );
        vm.stopPrank();

        assertEq(sourceVault.balanceOf(ALICE), sharesBefore);
        assertEq(output.balanceOf(ALICE), 0);
        assertEq(output.balanceOf(address(router)), 0);
        assertEq(callbackToken.balanceOf(address(router)), 0);
    }

    function testRedeemToTokenRejectsIncompleteLiquidation() public {
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(assetA), address(input), type(uint256).max, 50 * ONE);
        uint256 sharesBefore = sourceVault.balanceOf(ALICE);

        vm.startPrank(ALICE);
        sourceVault.approve(address(router), 50 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.IncompleteLiquidation.selector, address(assetB), 50 * ONE
            )
        );
        router.redeemToToken(
            BasketRedeemRequest({
                vault: address(sourceVault),
                outputToken: address(input),
                shares: 50 * ONE,
                minAmountOut: 50 * ONE,
                deadline: block.timestamp + 1
            }),
            _zeroMinimums(),
            legs
        );
        vm.stopPrank();

        assertEq(sourceVault.balanceOf(ALICE), sharesBefore);
        _assertRouterClean();
    }

    function testRedeemToTokenRejectsConstituentInjectedByOutputTransfer() public {
        MockReentrantToken output = new MockReentrantToken("Output", "OUT", 18);
        output.mint(address(venue), 100 * ONE);
        _createPool(address(assetA), address(output));
        _createPool(address(assetB), address(output));
        output.configureCallback(
            address(assetB), abi.encodeCall(assetB.mint, (address(router), ONE)), true
        );
        output.configureCallbackSender(address(router));

        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(assetA), address(output), type(uint256).max, 50 * ONE);
        legs[1] = _leg(address(assetB), address(output), type(uint256).max, 50 * ONE);
        uint256 sharesBefore = sourceVault.balanceOf(ALICE);
        uint256 supplyBefore = sourceVault.totalSupply();
        uint256 assetABackingBefore = assetA.balanceOf(address(sourceVault));
        uint256 assetBBackingBefore = assetB.balanceOf(address(sourceVault));
        uint256 assetAVenueBefore = assetA.balanceOf(address(venue));
        uint256 assetBVenueBefore = assetB.balanceOf(address(venue));
        uint256 assetBSupplyBefore = assetB.totalSupply();
        uint256 outputVenueBefore = output.balanceOf(address(venue));

        vm.startPrank(ALICE);
        sourceVault.approve(address(router), 50 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.IncompleteLiquidation.selector, address(assetB), ONE
            )
        );
        router.redeemToToken(
            BasketRedeemRequest({
                vault: address(sourceVault),
                outputToken: address(output),
                shares: 50 * ONE,
                minAmountOut: 100 * ONE,
                deadline: block.timestamp + 1
            }),
            _zeroMinimums(),
            legs
        );
        vm.stopPrank();

        assertEq(sourceVault.balanceOf(ALICE), sharesBefore);
        assertEq(sourceVault.totalSupply(), supplyBefore);
        assertEq(sourceVault.allowance(ALICE, address(router)), 50 * ONE);
        assertEq(assetA.balanceOf(address(sourceVault)), assetABackingBefore);
        assertEq(assetB.balanceOf(address(sourceVault)), assetBBackingBefore);
        assertEq(assetA.balanceOf(address(venue)), assetAVenueBefore);
        assertEq(assetB.balanceOf(address(venue)), assetBVenueBefore);
        assertEq(assetB.totalSupply(), assetBSupplyBefore);
        assertEq(output.balanceOf(address(venue)), outputVenueBefore);
        assertEq(output.balanceOf(ALICE), 0);
        assertEq(output.balanceOf(address(router)), 0);
        assertFalse(output.callbackSucceeded());
        _assertRouterClean();
    }

    function testPreexistingRouterDustIsNeverConsumedOrRefunded() public {
        input.mint(address(router), 7 * ONE);
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(input), address(sourceVault), 10 * ONE, 10 * ONE);

        vm.startPrank(ALICE);
        input.approve(address(router), 20 * ONE);
        router.swapDirect(_directBuyRequest(20 * ONE, 10 * ONE), legs);
        vm.stopPrank();

        assertEq(input.balanceOf(address(router)), 7 * ONE);
        assertEq(input.allowance(address(router), address(venue)), 0);
    }

    function testNoArbitraryTargetOrCallbackSurfaceExists() public {
        (bool targetSuccess,) = address(router)
            .call(abi.encodeWithSignature("execute(address,bytes)", address(venue), hex"deadbeef"));
        assertFalse(targetSuccess);
        (bool callbackSuccess,) = address(router)
            .call(
                abi.encodeWithSignature("uniswapV3SwapCallback(int256,int256,bytes)", 1, -1, hex"")
            );
        assertFalse(callbackSuccess);
    }

    function testTwentyConstituentBasketSucceedsAndTwentyOneIsRejected() public {
        address[] memory twentyAssets = new address[](20);
        V3Swap[] memory legs = new V3Swap[](20);
        for (uint256 i = 0; i < twentyAssets.length; i++) {
            MockStockToken asset = new MockStockToken("Constituent", "C", 18);
            twentyAssets[i] = address(asset);
            asset.mint(address(venue), 100 * ONE);
            _createPool(address(input), address(asset));
            legs[i] = _leg(address(input), address(asset), ONE, ONE);
        }
        MockOTFSettlementVault twentyVault =
            new MockOTFSettlementVault("Twenty", "TWENTY", twentyAssets);
        protocolFactory.setVault(address(twentyVault), true);
        twentyVault.setRouter(address(router));

        vm.startPrank(ALICE);
        input.approve(address(router), 20 * ONE);
        (uint256 shares,) = router.mintFromToken(
            BasketMintRequest({
                inputToken: address(input),
                vault: address(twentyVault),
                amountIn: 20 * ONE,
                minShares: ONE,
                deadline: block.timestamp + 1
            }),
            legs
        );
        vm.stopPrank();
        assertEq(shares, ONE);

        address[] memory twentyOneAssets = new address[](21);
        for (uint256 i = 0; i < twentyAssets.length; i++) {
            twentyOneAssets[i] = twentyAssets[i];
        }
        twentyOneAssets[20] = address(new MockStockToken("Extra", "EXTRA", 18));
        MockOTFSettlementVault oversized =
            new MockOTFSettlementVault("Oversized", "OVER", twentyOneAssets);
        protocolFactory.setVault(address(oversized), true);
        oversized.setRouter(address(router));

        vm.startPrank(ALICE);
        input.approve(address(router), ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.InvalidArrayLength.selector);
        router.mintFromToken(
            BasketMintRequest({
                inputToken: address(input),
                vault: address(oversized),
                amountIn: ONE,
                minShares: ONE,
                deadline: block.timestamp + 1
            }),
            new V3Swap[](0)
        );
        vm.stopPrank();
    }

    function testFortyOneLegRouteIsRejectedBeforeFundsMove() public {
        V3Swap[] memory legs = new V3Swap[](41);
        for (uint256 i = 0; i < legs.length; i++) {
            legs[i] = _leg(address(input), address(sourceVault), 1, 1);
        }
        uint256 beforeBalance = input.balanceOf(ALICE);
        vm.startPrank(ALICE);
        input.approve(address(router), ONE);
        vm.expectRevert(abi.encodeWithSelector(OTFEntryExitRouter.TooManyLegs.selector, 41, 40));
        router.swapDirect(_directBuyRequest(ONE, 1), legs);
        vm.stopPrank();
        assertEq(input.balanceOf(ALICE), beforeBalance);
    }

    function _buyRequest(uint256 minShares)
        private
        view
        returns (BasketMintRequest memory request)
    {
        request = BasketMintRequest({
            inputToken: address(input),
            vault: address(targetVault),
            amountIn: 100 * ONE,
            minShares: minShares,
            deadline: block.timestamp + 1
        });
    }

    function _directBuyRequest(uint256 amountIn, uint256 minAmountOut)
        private
        view
        returns (DirectSwapRequest memory request)
    {
        request = DirectSwapRequest({
            tokenIn: address(input),
            tokenOut: address(sourceVault),
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 1
        });
    }

    function _directSwapEventAmounts(Vm.Log[] memory logs)
        private
        view
        returns (uint256 grossAmountIn, uint256 inputRefunded, uint256 amountOut)
    {
        bytes32 eventSignature =
            keccak256("DirectSwapExecuted(address,address,address,uint256,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory log = logs[i];
            if (
                log.emitter != address(router) || log.topics.length == 0
                    || log.topics[0] != eventSignature
            ) {
                continue;
            }
            return abi.decode(log.data, (uint256, uint256, uint256));
        }
        revert("DirectSwapExecuted missing");
    }
}

/// @dev Executable upper-bound benchmark kept separate so its large fixture is built in `setUp`
///      and does not warm token or pool accounts in the measured test transaction.
contract OTFEntryExitRouterMaxRouteGasTest is AtomicRouterTestBase {
    uint256 private constant BENCHMARK_ASSET_COUNT = 20;
    uint256 private constant BENCHMARK_LEG_COUNT = 40;
    uint256 private constant BENCHMARK_INTERMEDIATE_COUNT = 80;
    uint256 private constant BENCHMARK_CONNECTOR_COUNT = 20;
    uint256 private constant BENCHMARK_TOKEN_COUNT =
        2 * BENCHMARK_ASSET_COUNT + BENCHMARK_INTERMEDIATE_COUNT + BENCHMARK_CONNECTOR_COUNT;
    uint256 private constant BENCHMARK_TRACKED_TOKEN_COUNT = BENCHMARK_TOKEN_COUNT + 2;

    event RouteGasUsed(
        string scenario,
        uint256 gasUsed,
        uint256 calldataBytes,
        uint256 trackedTokens,
        uint256 legs,
        uint256 hopsPerLeg
    );

    address[] private _benchmarkTokens;
    address[] private _benchmarkSourceAssets;
    address[] private _benchmarkTargetAssets;
    MockOTFSettlementVault private _benchmarkSourceVault;
    MockOTFSettlementVault private _benchmarkTargetVault;
    MockOTFSettlementVault private _benchmarkMirrorVault;

    function setUp() public {
        _setUpAtomicRouter();
        _setUpMaximumRouteFixture();
    }

    function testGasBenchmarkFortyLegsThreeHopsAnd142TrackedTokens() public {
        V3Swap[] memory legs = _maximumRouteLegs();
        uint256[] memory sourceMinimums = new uint256[](BENCHMARK_ASSET_COUNT);
        BasketSwapRequest memory request = BasketSwapRequest({
            sourceVault: address(_benchmarkSourceVault),
            targetVault: address(_benchmarkTargetVault),
            sharesIn: 4 * ONE,
            minSharesOut: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        uint256 sharesOut = router.swapBasketToBasket(request, sourceMinimums, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "basket-cross-20-assets-40x3",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.swapBasketToBasket, (request, sourceMinimums, legs))
            .length,
            BENCHMARK_TRACKED_TOKEN_COUNT,
            BENCHMARK_LEG_COUNT,
            router.MAX_HOPS_PER_LEG()
        );

        assertEq(sharesOut, ONE);
        assertEq(_benchmarkSourceVault.balanceOf(ALICE), 0);
        assertEq(_benchmarkTargetVault.balanceOf(ALICE), ONE);
        for (uint256 i = 0; i < BENCHMARK_TOKEN_COUNT; i++) {
            assertEq(MockStockToken(_benchmarkTokens[i]).balanceOf(address(router)), 0);
        }
        for (uint256 i = 0; i < BENCHMARK_ASSET_COUNT; i++) {
            assertEq(
                MockStockToken(_benchmarkSourceAssets[i])
                    .allowance(address(router), address(venue)),
                0
            );
            assertEq(
                MockStockToken(_benchmarkTargetAssets[i])
                    .allowance(address(router), address(_benchmarkTargetVault)),
                0
            );
            assertEq(
                MockStockToken(_benchmarkTokens[120 + i])
                    .allowance(address(router), address(venue)),
                0
            );
            assertEq(
                MockStockToken(_benchmarkSourceAssets[i]).balanceOf(ALICE), i == 0 ? 2 * ONE : ONE
            );
            assertEq(MockStockToken(_benchmarkTokens[120 + i]).balanceOf(ALICE), ONE);
            assertEq(MockStockToken(_benchmarkTargetAssets[i]).balanceOf(ALICE), i == 0 ? 0 : ONE);
        }
    }

    function testOneMoreTrackedTokenIsRejectedBeforeExecution() public {
        V3Swap[] memory legs = _maximumRouteLegs();
        legs[BENCHMARK_LEG_COUNT - 1].path = abi.encodePacked(
            _benchmarkTokens[139],
            bytes3(FEE),
            _benchmarkTokens[118],
            bytes3(FEE),
            _benchmarkTokens[119],
            bytes3(FEE),
            address(assetA)
        );
        uint256[] memory sourceMinimums = new uint256[](BENCHMARK_ASSET_COUNT);
        BasketSwapRequest memory request = BasketSwapRequest({
            sourceVault: address(_benchmarkSourceVault),
            targetVault: address(_benchmarkTargetVault),
            sharesIn: 4 * ONE,
            minSharesOut: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.TooManyRouteTokens.selector, router.MAX_TRACKED_TOKENS()
            )
        );
        router.swapBasketToBasket(request, sourceMinimums, legs);
    }

    function testGasBenchmarkDirectOneHop() public {
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(input), address(sourceVault), ONE, ONE);
        DirectSwapRequest memory request = DirectSwapRequest({
            tokenIn: address(input),
            tokenOut: address(sourceVault),
            amountIn: ONE,
            minAmountOut: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        uint256 amountOut = router.swapDirect(request, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "direct-1x1",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.swapDirect, (request, legs)).length,
            2,
            1,
            1
        );

        assertEq(amountOut, ONE);
        assertEq(sourceVault.balanceOf(ALICE), 10_001 * ONE);
        _assertRouterClean();
    }

    function testGasBenchmarkTwoAssetBasketBuy() public {
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(input), address(assetC), ONE, ONE);
        legs[1] = _leg(address(input), address(assetD), ONE, ONE);
        BasketMintRequest memory request = BasketMintRequest({
            inputToken: address(input),
            vault: address(targetVault),
            amountIn: 2 * ONE,
            minShares: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        (uint256 sharesOut, uint256 inputRefunded) = router.mintFromToken(request, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "basket-buy-2-assets-2x1",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.mintFromToken, (request, legs)).length,
            4,
            2,
            1
        );

        assertEq(sharesOut, ONE);
        assertEq(inputRefunded, 0);
        assertEq(targetVault.balanceOf(ALICE), ONE);
        _assertRouterClean();
    }

    function testGasBenchmarkTwoAssetBasketSell() public {
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(assetA), address(input), ONE, ONE);
        legs[1] = _leg(address(assetB), address(input), ONE, ONE);
        uint256[] memory sourceMinimums = new uint256[](2);
        BasketRedeemRequest memory request = BasketRedeemRequest({
            vault: address(sourceVault),
            outputToken: address(input),
            shares: ONE,
            minAmountOut: 2 * ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        uint256 amountOut = router.redeemToToken(request, sourceMinimums, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "basket-sell-2-assets-2x1",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.redeemToToken, (request, sourceMinimums, legs))
            .length,
            4,
            2,
            1
        );

        assertEq(amountOut, 2 * ONE);
        assertEq(sourceVault.balanceOf(ALICE), 9_999 * ONE);
        _assertRouterClean();
    }

    function testGasBenchmarkTwoAssetBasketCross() public {
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = _leg(address(assetA), address(assetC), ONE, ONE);
        legs[1] = _leg(address(assetB), address(assetD), ONE, ONE);
        uint256[] memory sourceMinimums = new uint256[](2);
        BasketSwapRequest memory request = BasketSwapRequest({
            sourceVault: address(sourceVault),
            targetVault: address(targetVault),
            sharesIn: ONE,
            minSharesOut: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        uint256 sharesOut = router.swapBasketToBasket(request, sourceMinimums, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "basket-cross-2-assets-2x1",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.swapBasketToBasket, (request, sourceMinimums, legs))
            .length,
            6,
            2,
            1
        );

        assertEq(sharesOut, ONE);
        assertEq(sourceVault.balanceOf(ALICE), 9_999 * ONE);
        assertEq(targetVault.balanceOf(ALICE), ONE);
        _assertRouterClean();
    }

    function testGasBenchmarkTwentyAssetBasketCrossWithoutLegs() public {
        V3Swap[] memory legs = new V3Swap[](0);
        uint256[] memory sourceMinimums = new uint256[](BENCHMARK_ASSET_COUNT);
        BasketSwapRequest memory request = BasketSwapRequest({
            sourceVault: address(_benchmarkSourceVault),
            targetVault: address(_benchmarkMirrorVault),
            sharesIn: ONE,
            minSharesOut: ONE,
            deadline: block.timestamp + 1
        });

        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        uint256 sharesOut = router.swapBasketToBasket(request, sourceMinimums, legs);
        uint256 gasUsed = gasBefore - gasleft();
        emit RouteGasUsed(
            "basket-cross-20-assets-no-legs",
            gasUsed,
            abi.encodeCall(OTFEntryExitRouter.swapBasketToBasket, (request, sourceMinimums, legs))
            .length,
            22,
            0,
            0
        );

        assertEq(sharesOut, ONE);
        assertEq(_benchmarkSourceVault.balanceOf(ALICE), 3 * ONE);
        assertEq(_benchmarkMirrorVault.balanceOf(ALICE), ONE);
        for (uint256 i = 0; i < BENCHMARK_ASSET_COUNT; i++) {
            assertEq(MockStockToken(_benchmarkSourceAssets[i]).balanceOf(address(router)), 0);
            assertEq(
                MockStockToken(_benchmarkSourceAssets[i])
                    .allowance(address(router), address(_benchmarkMirrorVault)),
                0
            );
        }
    }

    function _setUpMaximumRouteFixture() private {
        bytes memory tokenRuntime = type(MockStockToken).runtimeCode;
        _benchmarkTokens = new address[](BENCHMARK_TOKEN_COUNT);
        for (uint256 i = 0; i < BENCHMARK_TOKEN_COUNT; i++) {
            address token = address(uint160(0x0100_0000 + i));
            vm.etch(token, tokenRuntime);
            _benchmarkTokens[i] = token;
        }

        address[] memory sourceAssets = new address[](BENCHMARK_ASSET_COUNT);
        address[] memory targetAssets = new address[](BENCHMARK_ASSET_COUNT);
        for (uint256 i = 0; i < BENCHMARK_ASSET_COUNT; i++) {
            sourceAssets[i] = _benchmarkTokens[i];
            targetAssets[i] = _benchmarkTokens[20 + i];
        }
        _benchmarkSourceAssets = sourceAssets;
        _benchmarkTargetAssets = targetAssets;

        _benchmarkSourceVault =
            new MockOTFSettlementVault("Maximum Source", "MAX-SRC", sourceAssets);
        _benchmarkTargetVault =
            new MockOTFSettlementVault("Maximum Target", "MAX-TGT", targetAssets);
        _benchmarkMirrorVault =
            new MockOTFSettlementVault("Maximum Mirror", "MAX-MIRROR", sourceAssets);
        protocolFactory.setVault(address(_benchmarkSourceVault), true);
        protocolFactory.setVault(address(_benchmarkTargetVault), true);
        protocolFactory.setVault(address(_benchmarkMirrorVault), true);
        _benchmarkSourceVault.setRouter(address(router));
        _benchmarkTargetVault.setRouter(address(router));
        _benchmarkMirrorVault.setRouter(address(router));
        _benchmarkSourceVault.seedShares(ALICE, 4 * ONE);

        for (uint256 i = 0; i < BENCHMARK_ASSET_COUNT; i++) {
            MockStockToken(sourceAssets[i]).mint(address(_benchmarkSourceVault), 4 * ONE);
            MockStockToken(targetAssets[i]).mint(address(venue), i == 0 ? ONE : 2 * ONE);
            MockStockToken(_benchmarkTokens[120 + i])
                .mint(address(venue), i == 0 ? 2 * ONE : 3 * ONE);
        }

        for (uint256 i = 0; i < BENCHMARK_LEG_COUNT; i++) {
            (address tokenIn, address intermediate0, address intermediate1, address tokenOut) =
                _maximumRouteTuple(i);
            _createPool(tokenIn, intermediate0);
            _createPool(intermediate0, intermediate1);
            _createPool(intermediate1, tokenOut);
        }
        _createPool(_benchmarkTokens[119], address(assetA));

        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));

        vm.startPrank(ALICE);
        _benchmarkSourceVault.approve(address(router), 4 * ONE);
        input.approve(address(router), 2 * ONE);
        sourceVault.approve(address(router), 2 * ONE);
        vm.stopPrank();
    }

    function _maximumRouteLegs() private view returns (V3Swap[] memory legs) {
        legs = new V3Swap[](BENCHMARK_LEG_COUNT);
        for (uint256 i = 0; i < BENCHMARK_LEG_COUNT; i++) {
            (address tokenIn, address intermediate0, address intermediate1, address tokenOut) =
                _maximumRouteTuple(i);
            legs[i] = V3Swap({
                amountIn: _maximumRouteAmount(i),
                minAmountOut: ONE,
                path: abi.encodePacked(
                    tokenIn,
                    bytes3(FEE),
                    intermediate0,
                    bytes3(FEE),
                    intermediate1,
                    bytes3(FEE),
                    tokenOut
                )
            });
        }
    }

    function _maximumRouteTuple(uint256 leg)
        private
        view
        returns (address tokenIn, address intermediate0, address intermediate1, address tokenOut)
    {
        uint256 assetIndex = leg % BENCHMARK_ASSET_COUNT;
        tokenIn = leg < BENCHMARK_ASSET_COUNT
            ? _benchmarkSourceAssets[assetIndex]
            : _benchmarkTokens[120 + assetIndex];
        intermediate0 = _benchmarkTokens[40 + 2 * leg];
        intermediate1 = _benchmarkTokens[41 + 2 * leg];
        tokenOut = leg < BENCHMARK_ASSET_COUNT
            ? _benchmarkTokens[120 + assetIndex]
            : _benchmarkTargetAssets[assetIndex];
    }

    function _maximumRouteAmount(uint256 leg) private pure returns (uint256 amountIn) {
        uint256 assetIndex = leg % BENCHMARK_ASSET_COUNT;
        if (leg < BENCHMARK_ASSET_COUNT) return assetIndex == 0 ? 2 * ONE : 3 * ONE;
        return assetIndex == 0 ? ONE : 2 * ONE;
    }
}
