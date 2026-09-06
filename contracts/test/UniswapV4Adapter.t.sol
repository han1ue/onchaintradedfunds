// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { UniswapV4Adapter } from "../src/UniswapV4Adapter.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager,
    MockUniswapV4StateView
} from "./mocks/MockUniswapV4.sol";

contract UniswapV4AdapterTest is AtomicRouterTestBase {
    int24 private constant TICK_SPACING = 60;

    MockUniswapV4PoolManager private poolManager;
    MockPermit2 private permit2;
    MockUniswapV4StateView private stateView;
    MockUniswapUniversalRouter private universalRouter;
    UniswapV4Adapter private v4Adapter;

    function setUp() public {
        _setUpAtomicRouter();
        poolManager = new MockUniswapV4PoolManager();
        permit2 = new MockPermit2();
        stateView = new MockUniswapV4StateView(address(poolManager));
        universalRouter = new MockUniswapUniversalRouter(address(poolManager), address(permit2));
        v4Adapter = new UniswapV4Adapter(
            address(router),
            address(poolManager),
            address(stateView),
            address(universalRouter),
            address(permit2)
        );
        router.setAdapterApproved(address(v4Adapter), true);
    }

    function testConstructorAndExecutionBindRouterAndStateViewToPoolManager() public {
        MockUniswapV4PoolManager other = new MockUniswapV4PoolManager();
        universalRouter.setPoolManager(address(other));
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV4Adapter.RouterPoolManagerMismatch.selector,
                address(poolManager),
                address(other)
            )
        );
        new UniswapV4Adapter(
            address(router),
            address(poolManager),
            address(stateView),
            address(universalRouter),
            address(permit2)
        );

        universalRouter.setPoolManager(address(poolManager));
        stateView.setPoolManager(address(other));
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV4Adapter.StateViewPoolManagerMismatch.selector,
                address(poolManager),
                address(other)
            )
        );
        new UniswapV4Adapter(
            address(router),
            address(poolManager),
            address(stateView),
            address(universalRouter),
            address(permit2)
        );
    }

    function testOnlyBoundEntryRouterCanExecute() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(UniswapV4Adapter.UnauthorizedCaller.selector, ALICE));
        v4Adapter.executeSwap(address(input), address(assetC), ONE, ONE, _path(address(assetC)));
    }

    function testAuthenticatedThreeHopPathExecutesAndPreservesDonations() public {
        vm.warp(1_800_000_000);
        _createV4Pool(address(input), address(assetA));
        _createV4Pool(address(assetA), address(assetB));
        _createV4Pool(address(assetB), address(assetC));
        input.mint(address(v4Adapter), 6 * ONE);
        assetC.mint(address(v4Adapter), 7 * ONE);
        assetC.mint(address(universalRouter), ONE);

        PathKey[] memory path = new PathKey[](3);
        path[0] = _hop(address(assetA));
        path[1] = _hop(address(assetB));
        path[2] = _hop(address(assetC));
        vm.prank(address(router));
        uint256 amountOut =
            v4Adapter.executeSwap(address(input), address(assetC), ONE, ONE, abi.encode(path));

        assertEq(amountOut, ONE);
        assertEq(input.balanceOf(address(v4Adapter)), 5 * ONE);
        assertEq(assetC.balanceOf(address(v4Adapter)), 7 * ONE);
        assertEq(input.allowance(address(v4Adapter), address(permit2)), 0);
        (uint160 permitAmount, uint48 expiration,) =
            permit2.allowance(address(v4Adapter), address(input), address(universalRouter));
        assertEq(permitAmount, 0);
        assertEq(expiration, block.timestamp);
    }

    function testMalformedEndpointBoundsAndMissingPoolsAreRejected() public {
        _expectPathFailure(new PathKey[](0), UniswapV4Adapter.InvalidPath.selector);

        PathKey[] memory wrongEndpoint = new PathKey[](1);
        wrongEndpoint[0] = _hop(address(assetA));
        _createV4Pool(address(input), address(assetA));
        _expectPathFailure(wrongEndpoint, UniswapV4Adapter.InvalidPath.selector);

        PathKey[] memory fourHops = new PathKey[](4);
        fourHops[0] = _hop(address(assetA));
        fourHops[1] = _hop(address(assetB));
        fourHops[2] = _hop(address(assetD));
        fourHops[3] = _hop(address(assetC));
        _expectPathFailure(fourHops, UniswapV4Adapter.TooManyHops.selector);

        PathKey[] memory missing = new PathKey[](1);
        missing[0] = _hop(address(assetC));
        _expectPathFailure(missing, UniswapV4Adapter.UnauthenticatedPool.selector);

        PathKey[] memory invalidSpacing = new PathKey[](1);
        invalidSpacing[0] = PathKey(Currency.wrap(address(assetC)), FEE, 0, IHooks(address(0)), "");
        _expectPathFailure(invalidSpacing, UniswapV4Adapter.InvalidPath.selector);

        PathKey[] memory longHookData = new PathKey[](1);
        longHookData[0] = PathKey(
            Currency.wrap(address(assetC)), FEE, TICK_SPACING, IHooks(address(0)), new bytes(1_025)
        );
        _expectPathFailure(longHookData, UniswapV4Adapter.HookDataTooLong.selector);
    }

    function testInputConsumptionAndMinimumOutputAreIndependentlyChecked() public {
        _createV4Pool(address(input), address(assetC));
        input.mint(address(v4Adapter), 2 * ONE);
        assetC.mint(address(universalRouter), 2 * ONE);
        universalRouter.setSkipInputPull(true);
        vm.prank(address(router));
        vm.expectPartialRevert(UniswapV4Adapter.InputMismatch.selector);
        v4Adapter.executeSwap(address(input), address(assetC), ONE, ONE, _path(address(assetC)));

        universalRouter.setSkipInputPull(false);
        vm.prank(address(router));
        vm.expectRevert(bytes("SLIPPAGE"));
        v4Adapter.executeSwap(address(input), address(assetC), ONE, 2 * ONE, _path(address(assetC)));
    }

    function testV4AdapterIntegratesWithGenericBasketRouter() public {
        _createV4Pool(address(input), address(assetC));
        _createV4Pool(address(input), address(assetD));
        assetC.mint(address(universalRouter), ONE);
        assetD.mint(address(universalRouter), ONE);

        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = _v4Leg(address(input), address(assetC), ONE, ONE);
        legs[1] = _v4Leg(address(input), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        (uint256 shares, address[] memory refundTokens,) =
            router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(refundTokens.length, 0);
        assertEq(input.balanceOf(address(v4Adapter)), 0);
        assertEq(input.allowance(address(v4Adapter), address(permit2)), 0);
        _assertRouterClean();
    }

    function testFuzzGeneratedRoutesAndAtomicMinimum(uint256 seed, uint8 hopsSeed, bool allBalance)
        public
    {
        uint256 hops = 1 + hopsSeed % 3;
        uint256 amount = bound(seed, 1, 1 ether);
        address[2] memory middle =
            seed & 1 == 0 ? [address(assetA), address(assetB)] : [address(assetB), address(assetA)];
        PathKey[] memory path = new PathKey[](hops);
        address current = address(input);
        for (uint256 h; h < hops; h++) {
            address next = h + 1 == hops ? address(assetC) : middle[h];
            _createV4Pool(current, next);
            path[h] = _hop(next);
            current = next;
        }
        _createV4Pool(address(input), address(assetD));
        assetC.mint(address(universalRouter), amount);
        assetD.mint(address(universalRouter), amount);
        uint256 donation = 7 + seed % 101;
        input.mint(address(router), donation);
        assetC.mint(address(router), donation);
        input.mint(address(v4Adapter), donation);
        assetC.mint(address(v4Adapter), donation);
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = SwapLeg(
            address(v4Adapter), address(input), address(assetC), amount, amount, abi.encode(path)
        );
        legs[1] = _v4Leg(
            address(input), address(assetD), allBalance ? type(uint256).max : amount, amount + 1
        );
        uint256 beforeUser = input.balanceOf(ALICE);
        uint256 beforeVenue = input.balanceOf(address(universalRouter));
        vm.prank(ALICE);
        vm.expectRevert(bytes("SLIPPAGE"));
        router.mintFromToken(_mintRequest(2 * amount, amount), legs);
        assertEq(input.balanceOf(ALICE), beforeUser);
        assertEq(input.balanceOf(address(universalRouter)), beforeVenue);
        assertEq(input.balanceOf(address(router)), donation);
        assertEq(assetC.balanceOf(address(router)), donation);
        assertEq(targetVault.balanceOf(ALICE), 0);
        assertEq(input.allowance(address(v4Adapter), address(permit2)), 0);
        legs[1].minAmountOut = amount;
        vm.prank(ALICE);
        (uint256 minted,,) = router.mintFromToken(_mintRequest(2 * amount, amount), legs);
        assertEq(minted, amount);
        assertEq(input.balanceOf(ALICE), beforeUser - 2 * amount);
        assertEq(input.balanceOf(address(universalRouter)), beforeVenue + 2 * amount);
        assertEq(input.balanceOf(address(router)), donation);
        assertEq(assetC.balanceOf(address(router)), donation);
        assertEq(input.balanceOf(address(v4Adapter)), donation);
        assertEq(assetC.balanceOf(address(v4Adapter)), donation);
        assertEq(input.allowance(address(v4Adapter), address(permit2)), 0);
        (uint160 allowanceAmount,,) =
            permit2.allowance(address(v4Adapter), address(input), address(universalRouter));
        assertEq(allowanceAmount, 0);
    }

    function testFuzzV4InputBoundaryAndRollback(uint128 seed) public {
        uint256 amount = seed == 0 ? 1 : uint256(seed);
        _createV4Pool(address(input), address(assetC));
        input.mint(address(v4Adapter), amount + 7);
        assetC.mint(address(universalRouter), amount);
        uint256 beforeOut = assetC.balanceOf(address(router));
        vm.prank(address(router));
        vm.expectRevert(UniswapV4Adapter.InvalidAmount.selector);
        v4Adapter.executeSwap(
            address(input),
            address(assetC),
            uint256(type(uint128).max) + 1,
            1,
            _path(address(assetC))
        );
        assertEq(input.balanceOf(address(v4Adapter)), amount + 7);
        vm.prank(address(router));
        assertEq(
            v4Adapter.executeSwap(
                address(input), address(assetC), amount, amount, _path(address(assetC))
            ),
            amount
        );
        assertEq(input.balanceOf(address(v4Adapter)), 7);
        assertEq(assetC.balanceOf(address(router)), beforeOut + amount);
        assertEq(input.allowance(address(v4Adapter), address(permit2)), 0);
    }

    function _v4Leg(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimum)
        private
        view
        returns (SwapLeg memory)
    {
        return SwapLeg({
            adapter: address(v4Adapter),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minimum,
            data: _path(tokenOut)
        });
    }

    function _path(address tokenOut) private pure returns (bytes memory) {
        PathKey[] memory path = new PathKey[](1);
        path[0] = _hop(tokenOut);
        return abi.encode(path);
    }

    function _hop(address tokenOut) private pure returns (PathKey memory) {
        return PathKey(Currency.wrap(tokenOut), FEE, TICK_SPACING, IHooks(address(0)), "");
    }

    function _createV4Pool(address tokenA, address tokenB) private {
        stateView.setPool(_poolId(tokenA, tokenB, FEE, TICK_SPACING, address(0)), 1);
    }

    function _poolId(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, address hooks)
        private
        pure
        returns (bytes32)
    {
        (address currency0, address currency1) =
            tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks));
    }

    function _expectPathFailure(PathKey[] memory path, bytes4 selector) private {
        input.mint(address(v4Adapter), ONE);
        vm.prank(address(router));
        vm.expectPartialRevert(selector);
        v4Adapter.executeSwap(address(input), address(assetC), ONE, ONE, abi.encode(path));
    }
}
