// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { UniswapV3Adapter } from "../src/UniswapV3Adapter.sol";
import { MockUniswapV3Pool } from "./mocks/MockUniswapV3Factory.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";

contract TypedUniswapV3VenueTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testConstructorAndExecutionBindSwapRouterToFactory() public {
        venue.setFactory(address(protocolFactory));
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3Adapter.RouterFactoryMismatch.selector,
                address(v3Factory),
                address(protocolFactory)
            )
        );
        new UniswapV3Adapter(address(router), address(v3Factory), address(venue));

        venue.setFactory(address(protocolFactory));
        input.mint(address(v3Adapter), ONE);
        vm.prank(address(router));
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3Adapter.RouterFactoryMismatch.selector,
                address(v3Factory),
                address(protocolFactory)
            )
        );
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );
    }

    function testOnlyBoundEntryRouterCanExecute() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3Adapter.UnauthorizedCaller.selector, ALICE));
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );
    }

    function testMalformedWrongEndpointZeroFeeAndHopLimitPathsAreRejected() public {
        _expectPathFailure(hex"deadbeef", UniswapV3Adapter.InvalidPath.selector);
        _expectPathFailure(
            _path(address(assetA), address(assetC)), UniswapV3Adapter.InvalidPath.selector
        );
        _expectPathFailure(
            abi.encodePacked(address(input), bytes3(uint24(0)), address(assetC)),
            UniswapV3Adapter.InvalidPath.selector
        );

        bytes memory fourHop = abi.encodePacked(
            address(input),
            bytes3(FEE),
            address(assetA),
            bytes3(FEE),
            address(assetB),
            bytes3(FEE),
            address(assetD),
            bytes3(FEE),
            address(assetC)
        );
        input.mint(address(v3Adapter), ONE);
        vm.prank(address(router));
        vm.expectRevert(abi.encodeWithSelector(UniswapV3Adapter.TooManyHops.selector, 4, 3));
        v3Adapter.executeSwap(address(input), address(assetC), ONE, ONE, fourHop);
    }

    function testMissingAndForgedPoolsAreRejected() public {
        input.mint(address(v3Adapter), 2 * ONE);
        vm.prank(address(router));
        vm.expectPartialRevert(UniswapV3Adapter.UnauthenticatedPool.selector);
        v3Adapter.executeSwap(
            address(input),
            address(sourceVault),
            ONE,
            ONE,
            _path(address(input), address(sourceVault))
        );

        MockUniswapV3Pool forged =
            new MockUniswapV3Pool(address(protocolFactory), address(input), address(assetC), FEE);
        v3Factory.setPool(address(input), address(assetC), FEE, address(forged));
        vm.prank(address(router));
        vm.expectPartialRevert(UniswapV3Adapter.UnauthenticatedPool.selector);
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );
    }

    function testInputOutputSlippageAndReportedDeltasAreIndependentlyChecked() public {
        input.mint(address(v3Adapter), ONE);
        venue.setReportedOutputBonus(1);
        vm.prank(address(router));
        vm.expectPartialRevert(UniswapV3Adapter.OutputMismatch.selector);
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );

        venue.setReportedOutputBonus(0);
        venue.setSkipInputPull(true);
        vm.prank(address(router));
        vm.expectPartialRevert(UniswapV3Adapter.InputMismatch.selector);
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );

        venue.setSkipInputPull(false);
        vm.prank(address(router));
        vm.expectRevert(bytes("SLIPPAGE"));
        v3Adapter.executeSwap(
            address(input), address(assetC), ONE, 2 * ONE, _path(address(input), address(assetC))
        );
    }

    function testAdapterPreservesDonationsAndClearsAllowance() public {
        input.mint(address(v3Adapter), 6 * ONE);
        assetC.mint(address(v3Adapter), 7 * ONE);
        vm.prank(address(router));
        uint256 amountOut = v3Adapter.executeSwap(
            address(input), address(assetC), ONE, ONE, _path(address(input), address(assetC))
        );

        assertEq(amountOut, ONE);
        assertEq(input.balanceOf(address(v3Adapter)), 5 * ONE);
        assertEq(assetC.balanceOf(address(v3Adapter)), 7 * ONE);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
    }

    function testV3AdapterIntegratesWithGenericBasketRouter() public {
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _v3Leg(address(input), address(assetC), ONE, ONE);
        legs[1] = _v3Leg(address(input), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        (uint256 shares, address[] memory refundTokens,) =
            router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(refundTokens.length, 0);
        assertEq(input.balanceOf(address(v3Adapter)), 0);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
        _assertRouterClean();
    }

    function _expectPathFailure(bytes memory path, bytes4 selector) private {
        input.mint(address(v3Adapter), ONE);
        vm.prank(address(router));
        vm.expectRevert(selector);
        v3Adapter.executeSwap(address(input), address(assetC), ONE, ONE, path);
    }
}
