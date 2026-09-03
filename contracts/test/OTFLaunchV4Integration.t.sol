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

    function testOversizedWethBuyPartiallyFillsAndFinalizesAtomically() public {
        Setup memory setup = _deploy(true);
        setup.weth.mint(BUYER, 20 ether);
        vm.prank(BUYER);
        setup.weth.approve(address(setup.router), 20 ether);

        vm.recordLogs();
        vm.prank(BUYER);
        (uint256 amountIn, uint256 amountOut) = setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 burnEvents;
        bytes32 burnEventSignature = keccak256("RemainingOtfBurned(uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(setup.launch) && logs[i].topics[0] == burnEventSignature) {
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
        (uint256 amountIn,) = setup.router.buyOtfWithEth{value: 20 ether}(1, BUYER, block.timestamp + 1);

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

    function testStandaloneFinalizationBlocksInterveningSwapsAndHandlesInverseTick() public {
        Setup memory setup = _deploy(false);
        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        PoolKey memory key = _key(setup);
        setup.weth.mint(BUYER, 20 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), 20 ether);

        swapper.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(20 ether),
                sqrtPriceLimitX96: setup.launch.finalSqrtPriceX96()
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
        (, int24 storedTick,,) = setup.stateView.getSlot0(PoolId.wrap(setup.launch.poolId()));
        assertTrue(storedTick == 155_310);

        vm.expectRevert();
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: -int256(1), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(155_312)
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();

        vm.prank(address(0xF1A1));
        setup.launch.finalizeGraduation();
        _assertGraduated(setup, INVERSE_FINAL_BURN);
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

    function testExternalLiquidityDoesNotChangeManagerPrincipalSizing() public {
        Setup memory setup = _deploy(true);
        PoolModifyLiquidityTest externalLp = new PoolModifyLiquidityTest(IPoolManager(address(setup.poolManager)));
        setup.otf.mint(BUYER, 10_000 ether);
        setup.weth.mint(BUYER, 30 ether);
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
        setup.weth.approve(address(setup.router), type(uint256).max);
        setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);
        vm.stopPrank();

        assertEq(setup.launch.bootstrapWethProceeds(), PERMANENT_WETH);
        assertEq(setup.launch.bootstrapWethPrincipal(), PERMANENT_WETH);
        assertEq(setup.launch.permanentOtfLiquidity(), PERMANENT_OTF);
        assertEq(setup.launch.permanentWethLiquidity(), PERMANENT_WETH);
    }

    function testPostGraduationSwapsAndLockedPermanentNft() public {
        Setup memory setup = _deploy(true);
        setup.weth.mint(BUYER, 20 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(setup.router), 20 ether);
        setup.router.buyOtfWithWeth(20 ether, 1, BUYER, block.timestamp + 1);
        vm.stopPrank();
        assertEq(setup.positionManager.ownerOf(setup.launch.permanentPositionTokenId()), address(setup.launch));

        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(address(setup.poolManager)));
        PoolKey memory key = _key(setup);
        vm.mockCallRevert(
            address(setup.stateView),
            abi.encodeWithSelector(StateView.getSlot0.selector),
            bytes("graduated hook read pool state")
        );
        setup.weth.mint(BUYER, 1 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(swapper), 1 ether);
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.01 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-155_300)
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        vm.stopPrank();
        vm.clearMockedCalls();
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
        assertGt(setup.otf.balanceOf(BUYER), 0);
    }

    function _assertInitializationVectors(Setup memory setup, bool direct) private view {
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(uint256(uint160(address(setup.launch)) & ALL_HOOK_MASK), REQUIRED_HOOK_FLAGS);
        assertEq(setup.launch.BOOTSTRAP_LIQUIDITY(), 31_819_848_221_821_239_732_818);
        assertEq(setup.launch.PERMANENT_LIQUIDITY(), 21_213_049_526_830_492_717_974);
        assertEq(setup.launch.bootstrapLiquidity(), setup.launch.BOOTSTRAP_LIQUIDITY());
        assertEq(setup.launch.bootstrapOtfDeposited(), direct ? DIRECT_BOOTSTRAP_OTF : INVERSE_BOOTSTRAP_OTF);
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
            uint256(lower), direct ? 11_204_665_816_975_040_385_623_596 : 186_743_924_804_530_596_371_038_112_052_313
        );
        assertEq(
            uint256(upper), direct ? 33_613_418_706_697_289_737_079_801 : 560_222_128_702_570_272_483_239_940_334_470
        );
        assertEq(uint256(TickMath.getSqrtPriceAtTick(-887_272)), 4_295_128_739);
        assertEq(
            uint256(TickMath.getSqrtPriceAtTick(887_272)),
            1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
        );
        (uint160 sqrtPriceX96, int24 tick,,) = setup.stateView.getSlot0(PoolId.wrap(setup.launch.poolId()));
        assertEq(uint256(sqrtPriceX96), uint256(setup.launch.initialSqrtPriceX96()));
        assertTrue(tick == (direct ? int24(-177_285) : int24(177_284)));

        uint160 fullLower = TickMath.getSqrtPriceAtTick(-887_272);
        uint160 fullUpper = TickMath.getSqrtPriceAtTick(887_272);
        uint128 plusOne = setup.launch.PERMANENT_LIQUIDITY() + 1;
        uint256 plusOneOtf = direct
            ? SqrtPriceMath.getAmount0Delta(setup.launch.finalSqrtPriceX96(), fullUpper, plusOne, true)
            : SqrtPriceMath.getAmount1Delta(fullLower, setup.launch.finalSqrtPriceX96(), plusOne, true);
        assertEq(plusOneOtf, 50_000_000_000_000_000_000_001_166);
        assertGt(plusOneOtf, setup.launch.PERMANENT_OTF_CAP());
        _assertAllowancesCleared(setup);
    }

    function _assertPartialBuyAndSell(Setup memory setup) private {
        setup.weth.mint(BUYER, 2 ether);
        vm.startPrank(BUYER);
        setup.weth.approve(address(setup.router), 2 ether);
        (uint256 boughtIn, uint256 boughtOtf) = setup.router.buyOtfWithWeth(1 ether, 1, BUYER, block.timestamp + 1);
        assertEq(boughtIn, 1 ether);
        assertGt(boughtOtf, 0);
        assertEq(uint256(setup.launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        setup.otf.approve(address(setup.router), boughtOtf);
        (uint256 soldOtf, uint256 wethOut) = setup.router.sellOtfForWeth(boughtOtf, 1, BUYER, block.timestamp + 1);
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
        uint160 buyLimit = direct ? TickMath.getSqrtPriceAtTick(-155_310) : TickMath.getSqrtPriceAtTick(155_310);
        vm.expectRevert();
        swapper.swap(
            key,
            SwapParams({zeroForOne: !direct, amountSpecified: -int256(20 ether), sqrtPriceLimitX96: buyLimit}),
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
        uint160 sellLimit = direct ? TickMath.getSqrtPriceAtTick(-177_285) : TickMath.getSqrtPriceAtTick(177_285);
        vm.expectRevert();
        swapper.swap(
            key,
            SwapParams({zeroForOne: direct, amountSpecified: -int256(otfBalance), sqrtPriceLimitX96: sellLimit}),
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
        (uint160 otfAmount,,) =
            setup.permit2.allowance(address(setup.launch), address(setup.otf), address(setup.positionManager));
        (uint160 wethAmount,,) =
            setup.permit2.allowance(address(setup.launch), address(setup.weth), address(setup.positionManager));
        assertEq(uint256(otfAmount), 0);
        assertEq(uint256(wethAmount), 0);
    }

    function _deploy(bool direct) private returns (Setup memory setup) {
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
        setup.otf.mint(address(setup.launch), 200_000_000 ether);
        setup.launch.initializeLaunch();
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
            address candidateAddress = vm.computeCreate2Address(candidate, initCodeHash, address(deployer));
            if (uint160(candidateAddress) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
                return (candidate, candidateAddress);
            }
        }
        revert("launch hook address not found");
    }

    function _key(Setup memory setup) private view returns (PoolKey memory key) {
        (address currency0, address currency1, uint24 fee, int24 spacing, address hooks) = setup.launch.poolKey();
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });
    }
}
