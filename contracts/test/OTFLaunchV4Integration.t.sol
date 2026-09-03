// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OTFLaunchManager} from "../src/OTFLaunchManager.sol";
import {OTFLaunchManagerDeployer} from "../src/OTFLaunchManagerDeployer.sol";
import {OTFLaunchRouter} from "../src/OTFLaunchRouter.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {TestBase, Vm} from "./TestBase.sol";

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolDonateTest} from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

contract IntegrationOTF is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Onchain Traded Funds", "OTF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

contract OTFLaunchV4IntegrationTest is TestBase {
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 6);
    address private constant BUYER = address(0xB0B);

    uint256 private constant DIRECT_BOOTSTRAP_OTF = 149_997_417_396_300_392_474_813_256;
    uint256 private constant INVERSE_BOOTSTRAP_OTF = 149_997_417_396_300_392_474_813_274;
    uint256 private constant PERMANENT_WETH = 8_999_869_404_555_266_670;
    uint256 private constant DIRECT_BOUNDARY_WETH_INPUT = 8_999_869_404_555_266_707;
    uint256 private constant INVERSE_BOUNDARY_WETH_INPUT = 8_999_869_404_555_266_711;
    uint256 private constant PERMANENT_OTF = 49_999_999_999_999_999_999_998_809;
    uint256 private constant DIRECT_FINAL_BURN = 2_582_603_699_607_525_187_935;
    uint256 private constant INVERSE_FINAL_BURN = 2_582_603_699_607_525_187_917;

    struct Setup {
        IntegrationOTF otf;
        MockWETH weth;
        PoolManager poolManager;
        StateView stateView;
        IAllowanceTransfer permit2;
        PositionManager positionManager;
        OTFLaunchManager launch;
        OTFLaunchRouter router;
    }

    function setUp() public {
        vm.warp(1_000_000);
    }

    function testPinnedMathAndInitializationVectorsForBothCurrencyOrderings() public {
        _assertInitializationVectors(_deploy(true), true);
        _assertInitializationVectors(_deploy(false), false);
    }

    function testFundingBoundaryAndDerivedRequirementsForBothCurrencyOrderings() public {
        _assertFundingBoundary(true);
        _assertFundingBoundary(false);
    }

    function testOversizedWethBuyPartiallyFillsAndFinalizesAtomically() public {
        Setup memory setup = _deploy(true);
        setup.weth.mint(BUYER, 20 ether);
        vm.prank(BUYER);
        setup.weth.approve(address(setup.router), 20 ether);

        vm.recordLogs();
        vm.prank(BUYER);
        (uint256 amountIn, uint256 amountOut) =
            setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 burnEvents;
        bytes32 burnEventSignature = keccak256("RemainingOtfBurned(uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(setup.launch) && logs[i].topics[0] == burnEventSignature)
            {
                burnEvents++;
            }
        }

        assertEq(amountIn, DIRECT_BOUNDARY_WETH_INPUT);
        assertGt(amountOut, 0);
        assertEq(burnEvents, 1);
        assertEq(setup.weth.balanceOf(BUYER), 20 ether - DIRECT_BOUNDARY_WETH_INPUT);
        _assertGraduated(setup, DIRECT_FINAL_BURN);
    }

    function testOversizedNativeBuyRefundsUnusedEthAndFinalizes() public {
        Setup memory setup = _deploy(false);
        vm.deal(BUYER, 20 ether);

        vm.prank(BUYER);
        (uint256 amountIn,) =
            setup.router.buyOtfWithEth{value: 20 ether}(1, BUYER, block.timestamp + 1);

        assertEq(amountIn, INVERSE_BOUNDARY_WETH_INPUT);
        assertEq(BUYER.balance, 20 ether - INVERSE_BOUNDARY_WETH_INPUT);
        _assertGraduated(setup, INVERSE_FINAL_BURN);
    }

    function testPartialBuyAndSellRespectBothBootstrapBoundaries() public {
        _assertPartialBuyAndSell(_deploy(true));
        _assertPartialBuyAndSell(_deploy(false));
    }

    function testDeadlineAndMinimumOutputRevertWithoutChangingPool() public {
        Setup memory setup = _deploy(true);
        setup.weth.mint(BUYER, 2 ether);
        vm.prank(BUYER);
        setup.weth.approve(address(setup.router), 2 ether);
        (uint160 beforePrice,) = setup.launch.currentPoolState();

        vm.prank(BUYER);
        vm.expectPartialRevert(OTFLaunchRouter.DeadlinePassed.selector);
        setup.router.buyOtfWithWeth(1 ether, 1, BUYER, block.timestamp - 1);

        vm.prank(BUYER);
        vm.expectPartialRevert(OTFLaunchRouter.MinimumOutputNotMet.selector);
        setup.router.buyOtfWithWeth(1 ether, 200_000_000 ether, BUYER, block.timestamp + 1);
        (uint160 afterPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(afterPrice), uint256(beforePrice));
        assertEq(setup.weth.balanceOf(BUYER), 2 ether);
    }

    function testFinalizationFailureRollsBackBoundaryPurchase() public {
        Setup memory setup = _deploy(true);
        vm.prank(address(setup.launch));
        setup.otf.burn(3_000_000 ether);
        setup.weth.mint(BUYER, 20 ether);
        vm.prank(BUYER);
        setup.weth.approve(address(setup.router), 20 ether);
        (uint160 beforePrice,) = setup.launch.currentPoolState();

        vm.prank(BUYER);
        vm.expectRevert();
        setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);

        (uint160 afterPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(afterPrice), uint256(beforePrice));
        assertEq(setup.weth.balanceOf(BUYER), 20 ether);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
    }

    function testStandardRouterOvershootsRevertCompletely() public {
        _assertStandardOvershootsRevert(_deploy(true));
        _assertStandardOvershootsRevert(_deploy(false));
    }

    function testGraduationStateTransitionsEventsAndExactPrice() public {
        Setup memory setup = _deploy(true);

        vm.expectRevert(
            abi.encodeWithSelector(
                OTFLaunchManager.InvalidPhase.selector,
                OTFLaunchManager.Phase.GraduationReady,
                OTFLaunchManager.Phase.BootstrapActive
            )
        );
        setup.launch.finalizeGraduation();

        vm.roll(101);
        vm.warp(1_100_000);
        vm.recordLogs();
        _reachGraduationReady(setup);
        (uint160 readyPrice, int24 readyTick) = setup.launch.currentPoolState();
        assertEq(uint256(readyPrice), uint256(setup.launch.finalSqrtPriceX96()));
        assertEq(setup.launch.graduationReadyBlock(), 101);

        _expectGraduationPriceRecheck(setup, readyPrice - 1, readyTick);
        _expectGraduationPriceRecheck(setup, readyPrice + 1, readyTick);

        vm.roll(202);
        vm.warp(1_200_000);
        setup.launch.finalizeGraduation();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (uint160 graduatedPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(graduatedPrice), uint256(setup.launch.finalSqrtPriceX96()));
        assertEq(setup.launch.graduationReadyBlock(), 101);
        assertEq(setup.launch.graduationBlock(), 202);
        assertEq(setup.launch.graduationTimestamp(), 1_200_000);
        _assertGraduationEvents(logs, setup, 101, readyTick, 202, 1_200_000, DIRECT_FINAL_BURN);
        _assertGraduated(setup, DIRECT_FINAL_BURN);

        vm.expectRevert(
            abi.encodeWithSelector(
                OTFLaunchManager.InvalidPhase.selector,
                OTFLaunchManager.Phase.GraduationReady,
                OTFLaunchManager.Phase.Graduated
            )
        );
        setup.launch.finalizeGraduation();
    }

    function testBuysAndSellsRevertWhileGraduationReadyForBothCurrencyOrderings() public {
        _assertReadySwapsRevert(_deploy(true));
        _assertReadySwapsRevert(_deploy(false));
    }

    function testUnsolicitedTokensAndDonatedFeesDoNotResizePermanentPosition() public {
        Setup memory setup = _deploy(true);
        setup.weth.mint(BUYER, 30 ether);
        setup.otf.mint(BUYER, 1 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(setup.router), type(uint256).max);
        setup.router.buyOtfWithWeth(1 ether, 1, BUYER, block.timestamp + 1);
        vm.stopPrank();

        PoolDonateTest donor = new PoolDonateTest(IPoolManager(address(setup.poolManager)));
        setup.otf.mint(BUYER, 2_000);
        setup.weth.mint(BUYER, 2_000);
        vm.startPrank(BUYER);
        setup.otf.approve(address(donor), 2_000);
        setup.weth.approve(address(donor), 2_000);
        donor.donate(_key(setup), 1_000, 1_000, bytes(""));
        vm.stopPrank();
        setup.otf.mint(address(setup.launch), 123);
        setup.weth.mint(address(setup.launch), 777);

        vm.prank(BUYER);
        setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);

        assertEq(setup.launch.permanentOtfLiquidity(), PERMANENT_OTF);
        assertEq(setup.launch.permanentWethLiquidity(), PERMANENT_WETH);
        assertEq(setup.launch.bootstrapOtfReturned(), 999);
        assertEq(setup.launch.bootstrapWethProceeds(), PERMANENT_WETH + 999);
        assertEq(setup.launch.bootstrapWethPrincipal(), PERMANENT_WETH);
        assertEq(setup.launch.finalOtfBurned(), DIRECT_FINAL_BURN + 1_122);
        (, uint256 wethDust) = setup.launch.lockedDustBalances();
        assertEq(wethDust, 1_776);
    }

    function testExternalLiquidityCanBeAddedAndRemovedWhileReadyWithoutChangingPriceOrSizing()
        public
    {
        Setup memory setup = _deploy(true);
        _reachGraduationReady(setup);
        (uint160 readyPrice,) = setup.launch.currentPoolState();
        PoolModifyLiquidityTest externalLp =
            new PoolModifyLiquidityTest(IPoolManager(address(setup.poolManager)));
        setup.otf.mint(BUYER, 10_000 ether);
        setup.weth.mint(BUYER, 10 ether);
        vm.startPrank(BUYER);
        setup.otf.approve(address(externalLp), type(uint256).max);
        setup.weth.approve(address(externalLp), type(uint256).max);
        externalLp.modifyLiquidity(
            _key(setup),
            ModifyLiquidityParams({
                tickLower: -887_272,
                tickUpper: 887_272,
                liquidityDelta: int256(uint256(1 ether)),
                salt: bytes32("external")
            }),
            bytes("")
        );
        (uint160 priceAfterAdd,) = setup.launch.currentPoolState();
        assertEq(uint256(priceAfterAdd), uint256(readyPrice));
        assertEq(setup.stateView.getLiquidity(PoolId.wrap(setup.launch.poolId())), 1 ether);
        externalLp.modifyLiquidity(
            _key(setup),
            ModifyLiquidityParams({
                tickLower: -887_272,
                tickUpper: 887_272,
                liquidityDelta: -int256(uint256(1 ether)),
                salt: bytes32("external")
            }),
            bytes("")
        );
        vm.stopPrank();

        (uint160 priceAfterRemove,) = setup.launch.currentPoolState();
        assertEq(uint256(priceAfterRemove), uint256(readyPrice));
        assertEq(setup.stateView.getLiquidity(PoolId.wrap(setup.launch.poolId())), 0);
        setup.launch.finalizeGraduation();

        assertEq(setup.launch.bootstrapWethProceeds(), PERMANENT_WETH);
        assertEq(setup.launch.bootstrapWethPrincipal(), PERMANENT_WETH);
        assertEq(setup.launch.permanentOtfLiquidity(), PERMANENT_OTF);
        assertEq(setup.launch.permanentWethLiquidity(), PERMANENT_WETH);
    }

    function testPostGraduationBuysAndSellsPreservePermanentPositionForBothCurrencyOrderings()
        public
    {
        _assertPostGraduationTrading(_deploy(true));
        _assertPostGraduationTrading(_deploy(false));
    }

    function testThinLiquidityBridgeCannotOvershootGraduationPriceForBothCurrencyOrderings()
        public
    {
        _assertThinBridgeOvershootReverts(_deploy(true));
        _assertThinBridgeOvershootReverts(_deploy(false));
    }

    function _assertFundingBoundary(bool direct) private {
        Setup memory underfunded = _deployUninitialized(direct);
        uint256 required = underfunded.launch.REQUIRED_OTF_BALANCE();
        underfunded.otf.mint(address(underfunded.launch), required - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFLaunchManager.InsufficientLaunchTokens.selector, required, required - 1
            )
        );
        underfunded.launch.initializeLaunch();
        assertEq(
            uint256(underfunded.launch.phase()), uint256(OTFLaunchManager.Phase.NotInitialized)
        );

        Setup memory exact = _deployUninitialized(direct);
        exact.otf.mint(address(exact.launch), required);
        exact.launch.initializeLaunch();
        (uint256 bootstrapOtf,, uint256 permanentOtf,) = exact.launch.derivedLaunchAmounts();
        uint256 expectedBurn = direct ? DIRECT_FINAL_BURN : INVERSE_FINAL_BURN;
        assertEq(uint256(exact.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(exact.launch.bootstrapOtfDeposited(), bootstrapOtf);
        assertEq(exact.otf.balanceOf(address(exact.launch)), required - bootstrapOtf);
        assertLe(bootstrapOtf, exact.launch.MAX_BOOTSTRAP_BUDGET());
        assertLe(permanentOtf, exact.launch.PERMANENT_OTF_CAP());
        assertEq(required - bootstrapOtf - permanentOtf, expectedBurn);
    }

    function _assertReadySwapsRevert(Setup memory setup) private {
        PoolSwapTest swapper = _reachGraduationReady(setup);
        PoolKey memory key = _key(setup);
        bool direct = setup.launch.otfIsCurrency0();
        uint160 finalPrice = setup.launch.finalSqrtPriceX96();
        uint256 wethBefore = setup.weth.balanceOf(BUYER);
        uint256 otfBefore = setup.otf.balanceOf(BUYER);

        vm.startPrank(BUYER);
        setup.otf.approve(address(swapper), type(uint256).max);
        try swapper.swap(
            key,
            SwapParams({
                zeroForOne: !direct,
                amountSpecified: -int256(0.01 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    setup.launch.finalTick() + (direct ? int24(10) : -10)
                )
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        ) returns (
            BalanceDelta
        ) {
            revert("ready buy succeeded");
        } catch {}
        try swapper.swap(
            key,
            SwapParams({
                zeroForOne: direct,
                amountSpecified: -int256(1 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    setup.launch.finalTick() + (direct ? -10 : int24(10))
                )
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        ) returns (
            BalanceDelta
        ) {
            revert("ready sell succeeded");
        } catch {}
        vm.stopPrank();

        (uint160 priceAfter,) = setup.launch.currentPoolState();
        assertEq(uint256(priceAfter), uint256(finalPrice));
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
        assertEq(setup.weth.balanceOf(BUYER), wethBefore);
        assertEq(setup.otf.balanceOf(BUYER), otfBefore);
    }

    function _assertPostGraduationTrading(Setup memory setup) private {
        _reachGraduationReady(setup);
        setup.launch.finalizeGraduation();
        (uint160 graduatedPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(graduatedPrice), uint256(setup.launch.finalSqrtPriceX96()));

        uint256 tokenId = setup.launch.permanentPositionTokenId();
        uint256 principalOtf = setup.launch.permanentOtfLiquidity();
        uint256 principalWeth = setup.launch.permanentWethLiquidity();
        uint128 liquidity = setup.positionManager.getPositionLiquidity(tokenId);
        assertEq(setup.positionManager.ownerOf(tokenId), address(setup.launch));

        _executePostGraduationTrades(setup);

        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
        assertEq(setup.positionManager.ownerOf(tokenId), address(setup.launch));
        assertEq(setup.positionManager.getPositionLiquidity(tokenId), liquidity);
        assertEq(setup.launch.permanentOtfLiquidity(), principalOtf);
        assertEq(setup.launch.permanentWethLiquidity(), principalWeth);
    }

    function _executePostGraduationTrades(Setup memory setup) private {
        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        PoolKey memory key = _key(setup);
        bool direct = setup.launch.otfIsCurrency0();
        vm.mockCallRevert(
            address(setup.stateView),
            abi.encodeWithSelector(StateView.getSlot0.selector),
            bytes("graduated hook read pool state")
        );
        setup.weth.mint(BUYER, 1 ether);
        uint256 wethBeforeBuy = setup.weth.balanceOf(BUYER);
        uint256 otfBeforeBuy = setup.otf.balanceOf(BUYER);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), type(uint256).max);
        setup.otf.approve(address(swapper), type(uint256).max);
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: !direct,
                amountSpecified: -int256(0.01 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    setup.launch.finalTick() + (direct ? int24(20) : -20)
                )
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        uint256 wethAfterBuy = setup.weth.balanceOf(BUYER);
        uint256 otfAfterBuy = setup.otf.balanceOf(BUYER);
        assertLt(wethAfterBuy, wethBeforeBuy);
        assertGt(otfAfterBuy, otfBeforeBuy);

        swapper.swap(
            key,
            SwapParams({
                zeroForOne: direct,
                amountSpecified: -int256(1 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    setup.launch.finalTick() + (direct ? -20 : int24(20))
                )
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();
        vm.clearMockedCalls();

        assertEq(setup.otf.balanceOf(BUYER), otfAfterBuy - 1 ether);
        assertGt(setup.weth.balanceOf(BUYER), wethAfterBuy);
    }

    function _assertThinBridgeOvershootReverts(Setup memory setup) private {
        bool direct = setup.launch.otfIsCurrency0();
        setup.weth.mint(BUYER, 30 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(setup.router), type(uint256).max);
        setup.router.buyOtfWithWeth(8.99 ether, 1, BUYER, block.timestamp + 1);
        vm.stopPrank();

        int24 bridgeLower = setup.launch.finalTick() - 32;
        int24 bridgeUpper = setup.launch.finalTick() + 32;
        (uint160 closePrice, int24 closeTick) = setup.launch.currentPoolState();
        assertTrue(closeTick >= bridgeLower && closeTick < bridgeUpper);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));

        PoolModifyLiquidityTest thinLp = _addThinBridge(setup, bridgeLower, bridgeUpper);
        assertEq(
            setup.stateView.getLiquidity(PoolId.wrap(setup.launch.poolId())),
            setup.launch.BOOTSTRAP_LIQUIDITY() + 1 ether
        );

        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), type(uint256).max);
        _assertThinBridgeAttackReverts(setup, swapper, closePrice, direct);
        vm.stopPrank();

        _removeThinBridge(setup, thinLp, bridgeLower, bridgeUpper);
        assertEq(
            setup.stateView.getLiquidity(PoolId.wrap(setup.launch.poolId())),
            setup.launch.BOOTSTRAP_LIQUIDITY()
        );
        _completeLegitimateGraduation(setup, swapper, direct);
    }

    function _addThinBridge(Setup memory setup, int24 tickLower, int24 tickUpper)
        private
        returns (PoolModifyLiquidityTest thinLp)
    {
        thinLp = new PoolModifyLiquidityTest(IPoolManager(address(setup.poolManager)));
        setup.otf.mint(BUYER, 1_000_000 ether);
        vm.startPrank(BUYER);
        setup.otf.approve(address(thinLp), type(uint256).max);
        setup.weth.approve(address(thinLp), type(uint256).max);
        thinLp.modifyLiquidity(
            _key(setup),
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(1 ether)),
                salt: bytes32("thin bridge")
            }),
            bytes("")
        );
        vm.stopPrank();
    }

    function _removeThinBridge(
        Setup memory setup,
        PoolModifyLiquidityTest thinLp,
        int24 tickLower,
        int24 tickUpper
    ) private {
        vm.prank(BUYER);
        thinLp.modifyLiquidity(
            _key(setup),
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(1 ether)),
                salt: bytes32("thin bridge")
            }),
            bytes("")
        );
    }

    function _completeLegitimateGraduation(Setup memory setup, PoolSwapTest swapper, bool direct)
        private
    {
        setup.weth.mint(BUYER, 20 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), type(uint256).max);
        swapper.swap(
            _key(setup),
            SwapParams({
                zeroForOne: !direct,
                amountSpecified: -int256(20 ether),
                sqrtPriceLimitX96: setup.launch.finalSqrtPriceX96()
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();
        (uint160 boundaryPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(boundaryPrice), uint256(setup.launch.finalSqrtPriceX96()));
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));

        setup.launch.finalizeGraduation();
        _assertGraduated(setup, direct ? DIRECT_FINAL_BURN : INVERSE_FINAL_BURN);
    }

    function _assertThinBridgeAttackReverts(
        Setup memory setup,
        PoolSwapTest swapper,
        uint160 closePrice,
        bool direct
    ) private {
        uint256 wethBeforeAttack = setup.weth.balanceOf(BUYER);
        uint256 otfBeforeAttack = setup.otf.balanceOf(BUYER);
        try swapper.swap(
            _key(setup),
            SwapParams({
                zeroForOne: !direct,
                amountSpecified: -int256(1 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    setup.launch.finalTick() + (direct ? int24(16) : -16)
                )
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        ) returns (
            BalanceDelta
        ) {
            revert("thin bridge overshoot succeeded");
        } catch {}

        (uint160 priceAfterAttack,) = setup.launch.currentPoolState();
        (uint160 lower, uint160 upper) = setup.launch.bootstrapSqrtPriceBounds();
        assertEq(uint256(priceAfterAttack), uint256(closePrice));
        assertTrue(priceAfterAttack >= lower && priceAfterAttack <= upper);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(setup.weth.balanceOf(BUYER), wethBeforeAttack);
        assertEq(setup.otf.balanceOf(BUYER), otfBeforeAttack);
    }

    function _reachGraduationReady(Setup memory setup) private returns (PoolSwapTest swapper) {
        swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        setup.weth.mint(BUYER, 20 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), type(uint256).max);
        swapper.swap(
            _key(setup),
            SwapParams({
                zeroForOne: !setup.launch.otfIsCurrency0(),
                amountSpecified: -int256(20 ether),
                sqrtPriceLimitX96: setup.launch.finalSqrtPriceX96()
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
    }

    function _expectGraduationPriceRecheck(Setup memory setup, uint160 mockedPrice, int24 tick)
        private
    {
        bytes memory callData =
            abi.encodeWithSelector(StateView.getSlot0.selector, PoolId.wrap(setup.launch.poolId()));
        vm.mockCall(
            address(setup.stateView), callData, abi.encode(mockedPrice, tick, uint24(0), uint24(0))
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFLaunchManager.GraduationPriceNotReached.selector,
                mockedPrice,
                setup.launch.finalSqrtPriceX96()
            )
        );
        setup.launch.finalizeGraduation();
        vm.clearMockedCalls();
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
    }

    function _assertGraduationEvents(
        Vm.Log[] memory logs,
        Setup memory setup,
        uint256 readyBlock,
        int24 readyTick,
        uint256 graduatedBlock,
        uint64 graduatedTimestamp,
        uint256 burned
    ) private view {
        bytes32 readySignature = keccak256("GraduationReady(uint256,int24)");
        bytes32 burnSignature = keccak256("RemainingOtfBurned(uint256)");
        bytes32 graduatedSignature =
            keccak256("Graduated(uint256,uint64,uint256,uint256,uint256,uint128)");
        uint256 readyEvents;
        uint256 burnEvents;
        uint256 graduatedEvents;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(setup.launch) || logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == readySignature) {
                readyEvents++;
                assertEq(logs[i].topics[1], bytes32(readyBlock));
                assertTrue(abi.decode(logs[i].data, (int24)) == readyTick);
            } else if (logs[i].topics[0] == burnSignature) {
                burnEvents++;
                assertEq(abi.decode(logs[i].data, (uint256)), burned);
            } else if (logs[i].topics[0] == graduatedSignature) {
                graduatedEvents++;
                assertEq(logs[i].topics[1], bytes32(graduatedBlock));
                (
                    uint64 timestamp,
                    uint256 tokenId,
                    uint256 otfLocked,
                    uint256 wethLocked,
                    uint128 liquidity
                ) = abi.decode(logs[i].data, (uint64, uint256, uint256, uint256, uint128));
                assertEq(timestamp, graduatedTimestamp);
                assertEq(tokenId, setup.launch.permanentPositionTokenId());
                assertEq(otfLocked, PERMANENT_OTF);
                assertEq(wethLocked, PERMANENT_WETH);
                assertEq(liquidity, setup.launch.PERMANENT_LIQUIDITY());
            }
        }
        assertEq(readyEvents, 1);
        assertEq(burnEvents, 1);
        assertEq(graduatedEvents, 1);
    }

    function _assertInitializationVectors(Setup memory setup, bool direct) private view {
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(uint256(uint160(address(setup.launch)) & ALL_HOOK_MASK), REQUIRED_HOOK_FLAGS);
        assertEq(setup.launch.BOOTSTRAP_LIQUIDITY(), 31_819_848_221_821_239_732_818);
        assertEq(setup.launch.PERMANENT_LIQUIDITY(), 21_213_049_526_830_492_717_974);
        assertEq(setup.launch.bootstrapLiquidity(), setup.launch.BOOTSTRAP_LIQUIDITY());
        assertEq(
            setup.launch.bootstrapOtfDeposited(),
            direct ? DIRECT_BOOTSTRAP_OTF : INVERSE_BOOTSTRAP_OTF
        );
        assertEq(
            setup.launch.MAX_BOOTSTRAP_BUDGET() - setup.launch.bootstrapOtfDeposited(),
            direct ? 2_582_603_699_607_525_186_744 : 2_582_603_699_607_525_186_726
        );

        (uint256 bootstrapOtf, uint256 bootstrapWeth, uint256 permanentOtf, uint256 permanentWeth) =
            setup.launch.derivedLaunchAmounts();
        assertEq(bootstrapOtf, direct ? DIRECT_BOOTSTRAP_OTF : INVERSE_BOOTSTRAP_OTF);
        assertEq(bootstrapWeth, PERMANENT_WETH);
        assertEq(permanentOtf, PERMANENT_OTF);
        assertEq(permanentWeth, PERMANENT_WETH);
        assertEq(setup.launch.PERMANENT_OTF_CAP() - permanentOtf, 1_191);

        (uint160 lower, uint160 upper) = setup.launch.bootstrapSqrtPriceBounds();
        assertEq(
            uint256(lower),
            direct
                ? 11_204_665_816_975_040_385_623_596
                : 186_743_924_804_530_596_371_038_112_052_313
        );
        assertEq(
            uint256(upper),
            direct
                ? 33_613_418_706_697_289_737_079_801
                : 560_222_128_702_570_272_483_239_940_334_470
        );
        assertEq(uint256(TickMath.getSqrtPriceAtTick(-887_272)), 4_295_128_739);
        assertEq(
            uint256(TickMath.getSqrtPriceAtTick(887_272)),
            1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
        );
        (uint160 sqrtPriceX96, int24 tick,,) =
            setup.stateView.getSlot0(PoolId.wrap(setup.launch.poolId()));
        assertEq(uint256(sqrtPriceX96), uint256(setup.launch.initialSqrtPriceX96()));
        assertTrue(tick == (direct ? int24(-177_285) : int24(177_284)));

        uint160 fullLower = TickMath.getSqrtPriceAtTick(-887_272);
        uint160 fullUpper = TickMath.getSqrtPriceAtTick(887_272);
        uint128 plusOne = setup.launch.PERMANENT_LIQUIDITY() + 1;
        uint256 plusOneOtf = direct
            ? SqrtPriceMath.getAmount0Delta(
                setup.launch.finalSqrtPriceX96(), fullUpper, plusOne, true
            )
            : SqrtPriceMath.getAmount1Delta(
                fullLower, setup.launch.finalSqrtPriceX96(), plusOne, true
            );
        assertEq(plusOneOtf, 50_000_000_000_000_000_000_001_166);
        assertGt(plusOneOtf, setup.launch.PERMANENT_OTF_CAP());
        _assertAllowancesCleared(setup);
    }

    function _assertPartialBuyAndSell(Setup memory setup) private {
        setup.weth.mint(BUYER, 2 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(setup.router), 2 ether);
        (uint256 boughtIn, uint256 boughtOtf) =
            setup.router.buyOtfWithWeth(1 ether, 1, BUYER, block.timestamp + 1);
        assertEq(boughtIn, 1 ether);
        assertGt(boughtOtf, 0);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        setup.otf.approve(address(setup.router), boughtOtf);
        (uint256 soldOtf, uint256 wethOut) =
            setup.router.sellOtfForWeth(boughtOtf, 1, BUYER, block.timestamp + 1);
        vm.stopPrank();
        assertGt(soldOtf, 0);
        assertGt(wethOut, 0);
        (uint160 price,) = setup.launch.currentPoolState();
        (uint160 lower, uint160 upper) = setup.launch.bootstrapSqrtPriceBounds();
        assertTrue(price >= lower && price <= upper);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
    }

    function _assertStandardOvershootsRevert(Setup memory setup) private {
        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        PoolKey memory key = _key(setup);
        setup.weth.mint(BUYER, 20 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), type(uint256).max);
        (uint160 initialPrice,) = setup.launch.currentPoolState();
        bool direct = setup.launch.otfIsCurrency0();
        uint160 buyLimit =
            direct ? TickMath.getSqrtPriceAtTick(-155_310) : TickMath.getSqrtPriceAtTick(155_310);
        vm.expectRevert();
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: !direct, amountSpecified: -int256(20 ether), sqrtPriceLimitX96: buyLimit
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        (uint160 afterBuyPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(afterBuyPrice), uint256(initialPrice));

        setup.weth.approve(address(setup.router), 1 ether);
        setup.router.buyOtfWithWeth(1 ether, 1, BUYER, block.timestamp + 1);
        setup.otf.mint(BUYER, 200_000_000 ether);
        uint256 otfBalance = setup.otf.balanceOf(BUYER);
        setup.otf.approve(address(swapper), otfBalance);
        (uint160 beforeSellPrice,) = setup.launch.currentPoolState();
        uint160 sellLimit =
            direct ? TickMath.getSqrtPriceAtTick(-177_285) : TickMath.getSqrtPriceAtTick(177_285);
        vm.expectRevert();
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: direct,
                amountSpecified: -int256(otfBalance),
                sqrtPriceLimitX96: sellLimit
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();
        (uint160 afterSellPrice,) = setup.launch.currentPoolState();
        assertEq(uint256(afterSellPrice), uint256(beforeSellPrice));
    }

    function _assertGraduated(Setup memory setup, uint256 expectedBurn) private view {
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
        assertEq(setup.launch.bootstrapWethProceeds(), PERMANENT_WETH);
        assertEq(setup.launch.permanentLiquidity(), setup.launch.PERMANENT_LIQUIDITY());
        assertEq(setup.launch.permanentOtfLiquidity(), PERMANENT_OTF);
        assertEq(setup.launch.permanentWethLiquidity(), PERMANENT_WETH);
        assertEq(setup.launch.finalOtfBurned(), expectedBurn);
        assertEq(setup.otf.balanceOf(address(setup.launch)), 0);
        assertEq(setup.launch.bootstrapOtfReturned(), 0);
        _assertAllowancesCleared(setup);
    }

    function _assertAllowancesCleared(Setup memory setup) private view {
        assertEq(setup.otf.allowance(address(setup.launch), address(setup.permit2)), 0);
        assertEq(setup.weth.allowance(address(setup.launch), address(setup.permit2)), 0);
        (uint160 otfAmount,,) = setup.permit2
            .allowance(address(setup.launch), address(setup.otf), address(setup.positionManager));
        (uint160 wethAmount,,) = setup.permit2
            .allowance(address(setup.launch), address(setup.weth), address(setup.positionManager));
        assertEq(uint256(otfAmount), 0);
        assertEq(uint256(wethAmount), 0);
    }

    function _deploy(bool direct) private returns (Setup memory setup) {
        setup = _deployUninitialized(direct);
        setup.otf.mint(address(setup.launch), 200_000_000 ether);
        setup.launch.initializeLaunch();
    }

    function _deployUninitialized(bool direct) private returns (Setup memory setup) {
        setup.poolManager = new PoolManager(address(this));
        setup.stateView = new StateView(IPoolManager(address(setup.poolManager)));
        setup.permit2 = IAllowanceTransfer((new DeployPermit2()).deployPermit2());

        IntegrationOTF otfImplementation = new IntegrationOTF();
        MockWETH wethImplementation = new MockWETH();
        address otfAddress = direct ? address(0x1000) : address(0x2000);
        address wethAddress = direct ? address(0x2000) : address(0x1000);
        vm.etch(otfAddress, address(otfImplementation).code);
        vm.etch(wethAddress, address(wethImplementation).code);
        setup.otf = IntegrationOTF(otfAddress);
        setup.weth = MockWETH(payable(wethAddress));

        setup.positionManager = new PositionManager(
            IPoolManager(address(setup.poolManager)),
            IAllowanceTransfer(address(setup.permit2)),
            100_000,
            IPositionDescriptor(address(0)),
            IWETH9(address(setup.weth))
        );
        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        (bytes32 salt, address predicted) = _mineLaunchAddress(
            deployer,
            address(setup.otf),
            address(setup.weth),
            address(setup.poolManager),
            address(setup.stateView),
            address(setup.positionManager),
            address(setup.permit2)
        );
        setup.launch = deployer.deploy(
            salt,
            address(setup.otf),
            address(setup.weth),
            address(setup.poolManager),
            address(setup.stateView),
            address(setup.positionManager),
            address(setup.permit2)
        );
        assertEq(address(setup.launch), predicted);
        setup.router = new OTFLaunchRouter(address(setup.launch));
    }

    function _mineLaunchAddress(
        OTFLaunchManagerDeployer deployer,
        address otf,
        address weth,
        address poolManager,
        address stateView,
        address positionManager,
        address permit2
    ) private pure returns (bytes32 salt, address predicted) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(OTFLaunchManager).creationCode,
                abi.encode(otf, weth, poolManager, stateView, positionManager, permit2)
            )
        );
        for (uint256 i = 0; i < 100_000; i++) {
            bytes32 candidate = bytes32(i);
            address candidateAddress =
                vm.computeCreate2Address(candidate, initCodeHash, address(deployer));
            if (uint160(candidateAddress) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
                return (candidate, candidateAddress);
            }
        }
        revert("launch hook address not found");
    }

    function _key(Setup memory setup) private view returns (PoolKey memory key) {
        (address currency0, address currency1, uint24 fee, int24 spacing, address hooks) =
            setup.launch.poolKey();
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });
    }
}
