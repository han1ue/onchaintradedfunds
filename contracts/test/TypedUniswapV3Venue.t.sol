// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DirectSwapRequest, OTFEntryExitRouter, V3Swap } from "../src/OTFEntryExitRouter.sol";
import { MockUniswapV3Pool } from "./mocks/MockUniswapV3Factory.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";

/// @dev Tests the router's immutable, typed, factory-authenticated V3 execution boundary.
contract TypedUniswapV3VenueTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testConstructorBindsRouterToItsReportedFactory() public {
        venue.setFactory(address(protocolFactory));
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.RouterFactoryMismatch.selector,
                address(v3Factory),
                address(protocolFactory)
            )
        );
        new OTFEntryExitRouter(address(protocolFactory), address(v3Factory), address(venue));
    }

    function testVenueCannotChangeItsReportedFactoryAfterDeployment() public {
        venue.setFactory(address(protocolFactory));
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(input), address(sourceVault), ONE, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFEntryExitRouter.RouterFactoryMismatch.selector,
                address(v3Factory),
                address(protocolFactory)
            )
        );
        router.swapDirect(_request(ONE, 1), legs);
    }

    function testEveryPackedPathHopIsStructurallyParsedAndFactoryAuthenticated() public {
        V3Swap[] memory malformed = new V3Swap[](1);
        malformed[0] = V3Swap({ amountIn: ONE, minAmountOut: 1, path: hex"deadbeef" });
        vm.expectRevert(abi.encodeWithSelector(OTFEntryExitRouter.InvalidPath.selector, uint256(0)));
        router.swapDirect(_request(ONE, 1), malformed);

        V3Swap[] memory missing = new V3Swap[](1);
        missing[0] = _leg(address(assetD), address(sourceVault), ONE, 1);
        vm.expectPartialRevert(OTFEntryExitRouter.UnauthenticatedPool.selector);
        router.swapDirect(_requestWithInput(address(assetD), ONE, 1), missing);

        MockUniswapV3Pool mismatched = new MockUniswapV3Pool(
            address(protocolFactory), address(input), address(sourceVault), FEE
        );
        v3Factory.setPool(address(input), address(sourceVault), FEE, address(mismatched));
        V3Swap[] memory mismatchedLeg = new V3Swap[](1);
        mismatchedLeg[0] = _leg(address(input), address(sourceVault), ONE, 1);
        vm.expectPartialRevert(OTFEntryExitRouter.UnauthenticatedPool.selector);
        router.swapDirect(_request(ONE, 1), mismatchedLeg);
    }

    function testPathHopAndFeeBoundsAreEnforcedBeforeFundsMove() public {
        bytes memory fourHop = abi.encodePacked(
            address(input),
            bytes3(FEE),
            address(assetA),
            bytes3(FEE),
            address(assetB),
            bytes3(FEE),
            address(assetC),
            bytes3(FEE),
            address(sourceVault)
        );
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = V3Swap({ amountIn: ONE, minAmountOut: 1, path: fourHop });
        vm.expectRevert(
            abi.encodeWithSelector(OTFEntryExitRouter.TooManyHops.selector, uint256(4), uint256(3))
        );
        router.swapDirect(_request(ONE, 1), legs);

        legs[0].path = abi.encodePacked(address(input), bytes3(uint24(0)), address(sourceVault));
        vm.expectRevert(abi.encodeWithSelector(OTFEntryExitRouter.InvalidPath.selector, uint256(0)));
        router.swapDirect(_request(ONE, 1), legs);
    }

    function testVenueInputAndReportedOutputMustMatchObservedDeltas() public {
        V3Swap[] memory legs = new V3Swap[](1);
        legs[0] = _leg(address(input), address(sourceVault), 10 * ONE, 10 * ONE);
        uint256 beforeInput = input.balanceOf(ALICE);

        venue.setReportedOutputBonus(1);
        vm.startPrank(ALICE);
        input.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapOutputMismatch.selector);
        router.swapDirect(_request(10 * ONE, 10 * ONE), legs);
        vm.stopPrank();
        assertEq(input.balanceOf(ALICE), beforeInput);
        assertEq(input.allowance(address(router), address(venue)), 0);

        venue.setReportedOutputBonus(0);
        venue.setSkipInputPull(true);
        vm.startPrank(ALICE);
        input.approve(address(router), 0);
        input.approve(address(router), 10 * ONE);
        vm.expectPartialRevert(OTFEntryExitRouter.SwapInputMismatch.selector);
        router.swapDirect(_request(10 * ONE, 10 * ONE), legs);
        vm.stopPrank();
        assertEq(input.balanceOf(ALICE), beforeInput);
        assertEq(input.allowance(address(router), address(venue)), 0);
    }

    function _request(uint256 amountIn, uint256 minOut)
        private
        view
        returns (DirectSwapRequest memory)
    {
        return _requestWithInput(address(input), amountIn, minOut);
    }

    function _requestWithInput(address tokenIn, uint256 amountIn, uint256 minOut)
        private
        view
        returns (DirectSwapRequest memory request)
    {
        request = DirectSwapRequest({
            tokenIn: tokenIn,
            tokenOut: address(sourceVault),
            amountIn: amountIn,
            minAmountOut: minOut,
            deadline: block.timestamp + 1
        });
    }
}
