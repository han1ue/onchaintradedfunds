// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { OTFLaunchManager } from "../src/OTFLaunchManager.sol";
import { OTFLaunchManagerDeployer } from "../src/OTFLaunchManagerDeployer.sol";
import { OTFLaunchRouter } from "../src/OTFLaunchRouter.sol";
import { MockWETH } from "./mocks/MockWETH.sol";
import { TestBase, InvariantTestBase } from "./TestBase.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolDonateTest } from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { StateView } from "@uniswap/v4-periphery/src/lens/StateView.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { DeployPermit2 } from "permit2/test/utils/DeployPermit2.sol";

interface InvariantVm {
    function warp(uint256 timestamp) external;
    function roll(uint256 height) external;
    function deal(address account, uint256 balance) external;
}

contract InvariantOTF is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Invariant OTF", "iOTF") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

contract OTFLaunchV4Handler {
    InvariantVm private constant VM =
        InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    InvariantOTF public immutable otf;
    MockWETH public immutable weth;
    OTFLaunchManager public immutable launch;
    OTFLaunchRouter public immutable router;
    PoolManager public immutable poolManager;
    StateView public immutable stateView;
    PositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    PoolSwapTest public immutable swapper;
    PoolDonateTest public immutable donor;
    PoolModifyLiquidityTest public immutable externalLp;
    bool public immutable direct;

    uint8 public highestPhase;
    bool public graduatedAtExactPrice;
    uint128 public externalLiquidity;
    bool public prematureLiquidityAdded;
    uint256 public successfulRouterSwaps;
    uint256 public failedActions;
    uint256 public routerInput;
    uint256 public routerOutput;

    constructor(
        InvariantOTF otf_,
        MockWETH weth_,
        OTFLaunchManager launch_,
        OTFLaunchRouter router_,
        PoolManager poolManager_,
        StateView stateView_,
        PositionManager positionManager_,
        IAllowanceTransfer permit2_
    ) {
        otf = otf_;
        weth = weth_;
        launch = launch_;
        router = router_;
        poolManager = poolManager_;
        stateView = stateView_;
        positionManager = positionManager_;
        permit2 = permit2_;
        direct = launch_.otfIsCurrency0();
        swapper = new PoolSwapTest(IPoolManager(address(poolManager_)));
        donor = new PoolDonateTest(IPoolManager(address(poolManager_)));
        externalLp = new PoolModifyLiquidityTest(IPoolManager(address(poolManager_)));
        highestPhase = uint8(launch_.phase());
    }

    receive() external payable { }

    function buyWithWeth(uint256 seed) external {
        uint256 amount = _bound(seed, 1e12, 12 ether);
        uint256 wethBefore = weth.balanceOf(address(this));
        uint256 otfBefore = otf.balanceOf(address(this));
        Snapshot memory beforeState = _snapshot();
        weth.mint(address(this), amount);
        weth.approve(address(router), amount);
        try router.buyOtfWithWeth(amount, 1, address(this), block.timestamp + 1) returns (
            uint256 amountIn, uint256 amountOut
        ) {
            require(wethBefore + amount - weth.balanceOf(address(this)) == amountIn, "weth input");
            require(otf.balanceOf(address(this)) - otfBefore == amountOut, "otf output");
            require(weth.balanceOf(address(router)) == 0, "router weth dust");
            require(otf.balanceOf(address(router)) == 0, "router otf dust");
            successfulRouterSwaps++;
            routerInput += amountIn;
            routerOutput += amountOut;
        } catch {
            failedActions++;
            require(weth.balanceOf(address(this)) == wethBefore + amount, "failed weth balance");
            require(otf.balanceOf(address(this)) == otfBefore, "failed otf balance");
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function buyWithNative(uint256 seed) external {
        uint256 amount = _bound(seed, 1e12, 12 ether);
        uint256 ethBefore = address(this).balance;
        uint256 otfBefore = otf.balanceOf(address(this));
        Snapshot memory beforeState = _snapshot();
        VM.deal(address(this), ethBefore + amount);
        try router.buyOtfWithEth{ value: amount }(1, address(this), block.timestamp + 1) returns (
            uint256 amountIn, uint256 amountOut
        ) {
            require(ethBefore + amount - address(this).balance == amountIn, "native input");
            require(otf.balanceOf(address(this)) - otfBefore == amountOut, "native output");
            require(address(router).balance == 0, "router eth dust");
            successfulRouterSwaps++;
            routerInput += amountIn;
            routerOutput += amountOut;
        } catch {
            failedActions++;
            require(address(this).balance == ethBefore + amount, "failed eth balance");
            require(otf.balanceOf(address(this)) == otfBefore, "failed native output");
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function sellOtf(uint256 seed) external {
        uint256 minted = _bound(seed, 1e12, 5_000_000 ether);
        otf.mint(address(this), minted);
        uint256 amount = _bound(seed >> 32, 1e12, minted);
        uint256 otfBefore = otf.balanceOf(address(this));
        uint256 wethBefore = weth.balanceOf(address(this));
        Snapshot memory beforeState = _snapshot();
        otf.approve(address(router), amount);
        try router.sellOtfForWeth(amount, 1, address(this), block.timestamp + 1) returns (
            uint256 amountIn, uint256 amountOut
        ) {
            require(otfBefore - otf.balanceOf(address(this)) == amountIn, "sell input");
            require(weth.balanceOf(address(this)) - wethBefore == amountOut, "sell output");
            require(amountIn <= amount, "sell maximum");
            successfulRouterSwaps++;
            routerInput += amountIn;
            routerOutput += amountOut;
        } catch {
            failedActions++;
            require(otf.balanceOf(address(this)) == otfBefore, "failed sell input");
            require(weth.balanceOf(address(this)) == wethBefore, "failed sell output");
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function addLiquidity(uint256 seed) external {
        uint128 amount = uint128(_bound(seed, 1, 2 ether));
        otf.mint(address(this), 20_000_000 ether);
        weth.mint(address(this), 20 ether);
        otf.approve(address(externalLp), type(uint256).max);
        weth.approve(address(externalLp), type(uint256).max);
        Snapshot memory beforeState = _snapshot();
        try externalLp.modifyLiquidity(
            _key(),
            ModifyLiquidityParams({
                tickLower: -887_272,
                tickUpper: 887_272,
                liquidityDelta: int256(uint256(amount)),
                salt: bytes32("invariant lp")
            }),
            bytes("")
        ) {
            externalLiquidity += amount;
            if (launch.phase() != OTFLaunchManager.Phase.Graduated) {
                prematureLiquidityAdded = true;
            }
        } catch {
            failedActions++;
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function removeLiquidity(uint256 seed) external {
        if (externalLiquidity == 0) return;
        uint128 amount = uint128(_bound(seed, 1, externalLiquidity));
        Snapshot memory beforeState = _snapshot();
        try externalLp.modifyLiquidity(
            _key(),
            ModifyLiquidityParams({
                tickLower: -887_272,
                tickUpper: 887_272,
                liquidityDelta: -int256(uint256(amount)),
                salt: bytes32("invariant lp")
            }),
            bytes("")
        ) {
            externalLiquidity -= amount;
        } catch {
            failedActions++;
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function donate(uint256 seed) external {
        uint256 amount0 = _bound(seed, 1, 1e12);
        uint256 amount1 = _bound(seed >> 64, 1, 1e12);
        otf.mint(address(this), amount0 + amount1);
        weth.mint(address(this), amount0 + amount1);
        otf.approve(address(donor), amount0 + amount1);
        weth.approve(address(donor), amount0 + amount1);
        Snapshot memory beforeState = _snapshot();
        try donor.donate(_key(), amount0, amount1, bytes("")) { }
        catch {
            failedActions++;
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function directPoolManagerSwap(uint256 seed) external {
        bool buy = seed & 1 == 0;
        uint256 amount = _bound(seed >> 1, 1e12, buy ? 12 ether : 5_000_000 ether);
        otf.mint(address(this), buy ? 0 : amount);
        weth.mint(address(this), buy ? amount : 0);
        otf.approve(address(swapper), type(uint256).max);
        weth.approve(address(swapper), type(uint256).max);
        Snapshot memory beforeState = _snapshot();
        uint256 otfBefore = otf.balanceOf(address(this));
        uint256 wethBefore = weth.balanceOf(address(this));
        uint160 limit =
            buy ? launch.finalSqrtPriceX96() : TickMath.getSqrtPriceAtTick(launch.initialTick());
        try swapper.swap(
            _key(),
            SwapParams({
                zeroForOne: buy != direct,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: limit
            }),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        ) { }
        catch {
            failedActions++;
            require(otf.balanceOf(address(this)) == otfBefore, "failed direct otf");
            require(weth.balanceOf(address(this)) == wethBefore, "failed direct weth");
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function attemptFinalization() external {
        Snapshot memory beforeState = _snapshot();
        OTFLaunchManager.Phase beforePhase = launch.phase();
        try launch.finalizeGraduation() {
            require(beforePhase == OTFLaunchManager.Phase.GraduationReady, "invalid finalize");
            require(launch.phase() == OTFLaunchManager.Phase.Graduated, "not graduated");
        } catch {
            failedActions++;
            require(beforePhase != OTFLaunchManager.Phase.GraduationReady, "ready stuck");
            _assertCoreRollback(beforeState);
        }
        _observePhase();
    }

    function warpAndRoll(uint256 seed) external {
        VM.warp(block.timestamp + seed % 30 days);
        VM.roll(block.number + (seed >> 64) % 10_000);
        _observePhase();
    }

    struct Snapshot {
        uint160 price;
        uint128 liquidity;
        uint8 phase;
    }

    function _snapshot() private view returns (Snapshot memory state) {
        (state.price,) = launch.currentPoolState();
        state.liquidity = stateView.getLiquidity(PoolId.wrap(launch.poolId()));
        state.phase = uint8(launch.phase());
    }

    function _assertCoreRollback(Snapshot memory beforeState) private view {
        Snapshot memory afterState = _snapshot();
        require(afterState.price == beforeState.price, "failed price rollback");
        require(afterState.liquidity == beforeState.liquidity, "failed liquidity rollback");
        require(afterState.phase == beforeState.phase, "failed phase rollback");
    }

    function _observePhase() private {
        uint8 current = uint8(launch.phase());
        require(current >= highestPhase, "phase regressed");
        if (current == uint8(OTFLaunchManager.Phase.GraduationReady)) {
            (uint160 price,) = launch.currentPoolState();
            require(price == launch.finalSqrtPriceX96(), "ready off boundary");
        }
        if (current == uint8(OTFLaunchManager.Phase.Graduated) && highestPhase < current) {
            (uint160 price,) = launch.currentPoolState();
            require(price == launch.finalSqrtPriceX96(), "graduated off boundary");
            graduatedAtExactPrice = true;
        }
        highestPhase = current;
    }

    function _key() private view returns (PoolKey memory key) {
        (address currency0, address currency1, uint24 fee, int24 spacing, address hooks) =
            launch.poolKey();
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });
    }

    function _bound(uint256 value, uint256 minimum, uint256 maximum)
        private
        pure
        returns (uint256)
    {
        return minimum + value % (maximum - minimum + 1);
    }
}

contract OTFLaunchV4InvariantTest is TestBase, InvariantTestBase {
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 11) | (1 << 6);

    OTFLaunchV4Handler private _directHandler;
    OTFLaunchV4Handler private _inverseHandler;

    function setUp() public {
        vm.warp(1_000_000);
        _directHandler = _deploy(true, address(0x1000), address(0x2000));
        _inverseHandler = _deploy(false, address(0x4000), address(0x3000));
        targetContract(address(_directHandler));
        targetContract(address(_inverseHandler));
    }

    function invariantLaunchPhaseOnlyMovesForward() public view {
        _assertPhase(_directHandler);
        _assertPhase(_inverseHandler);
    }

    function invariantBootstrapPriceCannotCrossBoundaryAndReadyIsExact() public view {
        _assertBoundary(_directHandler);
        _assertBoundary(_inverseHandler);
    }

    function invariantGraduatedPositionsAndAllowancesStayLocked() public view {
        _assertGraduatedState(_directHandler);
        _assertGraduatedState(_inverseHandler);
    }

    function invariantRouterNeverRetainsUserDust() public view {
        _assertRouterDust(_directHandler);
        _assertRouterDust(_inverseHandler);
    }

    function invariantExternalLiquidityCannotConsumeCapacityBeforeGraduation() public view {
        assertFalse(_directHandler.prematureLiquidityAdded());
        assertFalse(_inverseHandler.prematureLiquidityAdded());
    }

    function _assertPhase(OTFLaunchV4Handler handler) private view {
        uint8 current = uint8(handler.launch().phase());
        assertEq(uint256(current), uint256(handler.highestPhase()));
        assertTrue(current >= uint8(OTFLaunchManager.Phase.BootstrapActive));
        if (current == uint8(OTFLaunchManager.Phase.Graduated)) {
            assertTrue(handler.graduatedAtExactPrice());
        }
    }

    function _assertBoundary(OTFLaunchV4Handler handler) private view {
        OTFLaunchManager launch = handler.launch();
        OTFLaunchManager.Phase phase = launch.phase();
        (uint160 price,) = launch.currentPoolState();
        if (phase == OTFLaunchManager.Phase.BootstrapActive) {
            uint160 initial = launch.initialSqrtPriceX96();
            uint160 finalPrice = launch.finalSqrtPriceX96();
            uint160 lower = initial < finalPrice ? initial : finalPrice;
            uint160 upper = initial < finalPrice ? finalPrice : initial;
            assertTrue(price >= lower && price <= upper);
            assertTrue(price != finalPrice);
        } else if (phase == OTFLaunchManager.Phase.GraduationReady) {
            assertEq(uint256(price), uint256(launch.finalSqrtPriceX96()));
        }
    }

    function _assertGraduatedState(OTFLaunchV4Handler handler) private view {
        OTFLaunchManager launch = handler.launch();
        if (launch.phase() != OTFLaunchManager.Phase.Graduated) return;
        PositionManager positions = handler.positionManager();
        assertEq(positions.ownerOf(launch.permanentPositionTokenId()), address(launch));
        assertEq(
            positions.getPositionLiquidity(launch.permanentPositionTokenId()),
            launch.PERMANENT_LIQUIDITY()
        );
        assertEq(positions.getPositionLiquidity(launch.bootstrapPositionTokenId()), 0);
        assertEq(launch.permanentLiquidity(), launch.PERMANENT_LIQUIDITY());
        assertEq(handler.otf().balanceOf(address(launch)), 0);
        assertEq(handler.otf().allowance(address(launch), address(handler.permit2())), 0);
        assertEq(handler.weth().allowance(address(launch), address(handler.permit2())), 0);
        (uint160 otfAllowance,,) =
            handler.permit2().allowance(address(launch), address(handler.otf()), address(positions));
        (uint160 wethAllowance,,) = handler.permit2()
            .allowance(address(launch), address(handler.weth()), address(positions));
        assertEq(uint256(otfAllowance), 0);
        assertEq(uint256(wethAllowance), 0);

        (bool canWithdraw,) = address(launch)
            .staticcall(abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1));
        assertFalse(canWithdraw);
    }

    function _assertRouterDust(OTFLaunchV4Handler handler) private view {
        assertEq(handler.otf().balanceOf(address(handler.router())), 0);
        assertEq(handler.weth().balanceOf(address(handler.router())), 0);
        assertEq(address(handler.router()).balance, 0);
    }

    function _deploy(bool direct, address otfAddress, address wethAddress)
        private
        returns (OTFLaunchV4Handler handler)
    {
        PoolManager poolManager = new PoolManager(address(this));
        StateView stateView = new StateView(IPoolManager(address(poolManager)));
        IAllowanceTransfer permit2 = IAllowanceTransfer((new DeployPermit2()).deployPermit2());
        InvariantOTF otfImplementation = new InvariantOTF();
        MockWETH wethImplementation = new MockWETH();
        vm.etch(otfAddress, address(otfImplementation).code);
        vm.etch(wethAddress, address(wethImplementation).code);
        InvariantOTF otf = InvariantOTF(otfAddress);
        MockWETH weth = MockWETH(payable(wethAddress));
        assertEq(otfAddress < wethAddress, direct);

        PositionManager positionManager = new PositionManager(
            IPoolManager(address(poolManager)),
            permit2,
            100_000,
            IPositionDescriptor(address(0)),
            IWETH9(address(weth))
        );
        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        bytes32 salt = _mineLaunchAddress(
            deployer,
            otfAddress,
            wethAddress,
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        OTFLaunchManager launch = deployer.deploy(
            salt,
            otfAddress,
            wethAddress,
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        OTFLaunchRouter router = new OTFLaunchRouter(address(launch));
        otf.mint(address(this), launch.REQUIRED_OTF_BALANCE());
        otf.approve(address(launch), launch.REQUIRED_OTF_BALANCE());
        launch.initializeLaunch();
        handler = new OTFLaunchV4Handler(
            otf, weth, launch, router, poolManager, stateView, positionManager, permit2
        );
    }

    function _mineLaunchAddress(
        OTFLaunchManagerDeployer deployer,
        address otf,
        address weth,
        address poolManager,
        address stateView,
        address positionManager,
        address permit2
    ) private pure returns (bytes32 salt) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(OTFLaunchManager).creationCode,
                abi.encode(otf, weth, poolManager, stateView, positionManager, permit2)
            )
        );
        for (uint256 i; i < 100_000; i++) {
            bytes32 candidate = bytes32(i);
            address predicted = vm.computeCreate2Address(candidate, initCodeHash, address(deployer));
            if (uint160(predicted) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) return candidate;
        }
        revert("launch hook address not found");
    }
}
