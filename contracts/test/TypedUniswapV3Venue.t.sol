// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { UniswapV3Adapter } from "../src/UniswapV3Adapter.sol";
import { MockUniswapV3Pool } from "./mocks/MockUniswapV3Factory.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";

contract ResetApprovalNoReturnToken is MockStockToken {
    constructor() MockStockToken("Reset approval token", "RESET", 18) { }

    function approve(address spender, uint256 value) public override returns (bool) {
        require(value == 0 || allowance(msg.sender, spender) == 0, "RESET_ALLOWANCE");
        return super.approve(spender, value);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        super.transfer(to, value);
        assembly ("memory-safe") {
            return(0, 0)
        }
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        super.transferFrom(from, to, value);
        assembly ("memory-safe") {
            return(0, 0)
        }
    }
}

contract TypedUniswapV3VenueTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testFuzzGeneratedRoutesAndAtomicMinimum(uint256 seed, uint8 hopsSeed, bool allBalance)
        public
    {
        uint256 hops = 1 + hopsSeed % 3;
        uint256 amount = bound(seed, 1, 1 ether);
        address[2] memory middle =
            seed & 1 == 0 ? [address(assetA), address(assetB)] : [address(assetB), address(assetA)];
        bytes memory path = abi.encodePacked(address(input));
        address current = address(input);
        for (uint256 h; h < hops; h++) {
            address next = h + 1 == hops ? address(assetC) : middle[h];
            _createPool(current, next);
            path = bytes.concat(path, abi.encodePacked(bytes3(FEE), next));
            current = next;
        }
        uint256 donation = 7 + seed % 101;
        input.mint(address(router), donation);
        assetC.mint(address(router), donation);
        input.mint(address(v3Adapter), donation);
        assetC.mint(address(v3Adapter), donation);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = SwapLeg(address(v3Adapter), address(input), address(assetC), amount, amount, path);
        legs[1] = _v3Leg(
            address(input), address(assetD), allBalance ? type(uint256).max : amount, amount
        );
        uint256 beforeUser = input.balanceOf(ALICE);
        uint256 beforeVenue = input.balanceOf(address(venue));
        // Failure in the second leg must undo the first leg, all approvals, and the input pull.
        legs[1].minAmountOut = amount + 1;
        vm.prank(ALICE);
        vm.expectRevert(bytes("SLIPPAGE"));
        router.mintFromToken(_mintRequest(2 * amount, amount), legs);
        assertEq(input.balanceOf(ALICE), beforeUser);
        assertEq(input.balanceOf(address(venue)), beforeVenue);
        assertEq(input.balanceOf(address(router)), donation);
        assertEq(assetC.balanceOf(address(router)), donation);
        assertEq(targetVault.balanceOf(ALICE), 0);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
        legs[1].minAmountOut = amount;
        vm.prank(ALICE);
        (uint256 minted,,) = router.mintFromToken(_mintRequest(2 * amount, amount), legs);
        assertEq(minted, amount);
        assertEq(input.balanceOf(ALICE), beforeUser - 2 * amount);
        assertEq(input.balanceOf(address(venue)), beforeVenue + 2 * amount);
        assertEq(input.balanceOf(address(router)), donation);
        assertEq(assetC.balanceOf(address(router)), donation);
        assertEq(input.balanceOf(address(v3Adapter)), donation);
        assertEq(assetC.balanceOf(address(v3Adapter)), donation);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
    }

    function testFuzzV3LargeInputAndZeroRollback(uint128 seed) public {
        uint256 amount = seed == 0 ? 1 : uint256(seed);
        input.mint(address(v3Adapter), amount + 7);
        assetC.mint(address(venue), amount);
        uint256 beforeOut = assetC.balanceOf(address(router));
        vm.prank(address(router));
        vm.expectRevert(UniswapV3Adapter.InvalidAmount.selector);
        v3Adapter.executeSwap(
            address(input), address(assetC), 0, 1, _path(address(input), address(assetC))
        );
        assertEq(input.balanceOf(address(v3Adapter)), amount + 7);
        vm.prank(address(router));
        assertEq(
            v3Adapter.executeSwap(
                address(input),
                address(assetC),
                amount,
                amount,
                _path(address(input), address(assetC))
            ),
            amount
        );
        assertEq(input.balanceOf(address(v3Adapter)), 7);
        assertEq(assetC.balanceOf(address(router)), beforeOut + amount);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
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

    function testAdapterResetsExistingApprovalAndSupportsNoReturnTransfers() public {
        ResetApprovalNoReturnToken token = new ResetApprovalNoReturnToken();
        _createPool(address(token), address(assetC));
        token.mint(address(v3Adapter), 3 * ONE);
        vm.prank(address(v3Adapter));
        token.approve(address(venue), 1);

        for (uint256 i; i < 2; i++) {
            vm.prank(address(router));
            assertEq(
                v3Adapter.executeSwap(
                    address(token),
                    address(assetC),
                    ONE,
                    ONE,
                    _path(address(token), address(assetC))
                ),
                ONE
            );
            assertEq(token.allowance(address(v3Adapter), address(venue)), 0);
        }
        assertEq(token.balanceOf(address(v3Adapter)), ONE);
        assertEq(token.balanceOf(address(venue)), 2 * ONE);
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
