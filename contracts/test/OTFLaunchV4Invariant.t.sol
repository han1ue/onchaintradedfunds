// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ActionAccounting } from "./helpers/ActionAccounting.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
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

contract InvariantOTF is ERC20 {
    constructor() ERC20("Invariant OTF", "iOTF") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

contract OTFLaunchV4Handler is ActionAccounting {
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
    bool public hasSwapped;
    uint256 public successfulRouterSwaps;

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

    function selectors() public pure returns (bytes4[] memory s) {
        s = new bytes4[](11);
        s[0] = this.buyWithWeth.selector;
        s[1] = this.buyWithNative.selector;
        s[2] = this.sellOtf.selector;
        s[3] = this.addLiquidity.selector;
        s[4] = this.removeLiquidity.selector;
        s[5] = this.donate.selector;
        s[6] = this.directPoolManagerSwap.selector;
        s[7] = this.attemptFinalization.selector;
        s[8] = this.rejectInvalid.selector;
        s[9] = this.warpAndRoll.selector;
        s[10] = this.rejectPrematureLiquidity.selector;
    }

    function _active() private returns (bool) {
        if (launch.phase() == OTFLaunchManager.Phase.BootstrapActive) return true;
        noOps[msg.sig]++;
        return false;
    }

    function buyWithWeth(uint256 seed) public {
        if (!_active()) return;
        address actor = address(uint160(0xA000 + seed % 3));
        address recipient = address(uint160(0xB000 + (seed >> 8) % 3));
        uint256 amount = _bound(seed, 1e12, 12 ether);
        weth.mint(actor, amount);
        uint256 w = weth.balanceOf(actor);
        uint256 o = otf.balanceOf(recipient);
        vm.startPrank(actor);
        weth.approve(address(router), amount);
        (uint256 used, uint256 out) = router.buyOtfWithWeth(amount, 1, recipient, block.timestamp);
        vm.stopPrank();
        require(w - weth.balanceOf(actor) == used && used <= amount, "weth input");
        require(otf.balanceOf(recipient) - o == out && out >= 1, "otf output");
        hasSwapped = true;
        successfulRouterSwaps++;
        successes[msg.sig]++;
        _observePhase();
    }

    function buyWithNative(uint256 seed) public {
        if (!_active()) return;
        address actor = address(uint160(0xA000 + seed % 3));
        address recipient = address(uint160(0xB000 + (seed >> 8) % 3));
        uint256 amount = _bound(seed, 1e12, 12 ether);
        vm.deal(actor, actor.balance + amount);
        uint256 e = actor.balance;
        uint256 o = otf.balanceOf(recipient);
        vm.prank(actor);
        (uint256 used, uint256 out) =
            router.buyOtfWithEth{ value: amount }(1, recipient, block.timestamp);
        require(e - actor.balance == used && used <= amount, "native refund");
        require(otf.balanceOf(recipient) - o == out && out >= 1, "native output");
        hasSwapped = true;
        successfulRouterSwaps++;
        successes[msg.sig]++;
        _observePhase();
    }

    function sellOtf(uint256 seed) public {
        if (!_active()) return;
        (uint160 price,) = launch.currentPoolState();
        (uint160 lower, uint160 upper) = launch.bootstrapSqrtPriceBounds();
        uint160 limit = direct ? lower : upper;
        uint256 gap = price > limit ? price - limit : limit - price;
        if ((direct && price <= limit) || (!direct && price >= limit) || gap < uint256(price) / 1e8)
        {
            noOps[msg.sig]++;
            return;
        }
        address actor = address(uint160(0xB000 + seed % 3));
        address recipient = address(uint160(0xA000 + (seed >> 8) % 3));
        uint256 amount = _bound(seed, 1 ether, 1_000_000 ether);
        otf.mint(actor, amount);
        uint256 o = otf.balanceOf(actor);
        bool native = seed & 1 == 0;
        uint256 beforeOut = native ? recipient.balance : weth.balanceOf(recipient);
        vm.startPrank(actor);
        otf.approve(address(router), amount);
        (uint256 used, uint256 out) = native
            ? router.sellOtfForEth(amount, 1, recipient, block.timestamp)
            : router.sellOtfForWeth(amount, 1, recipient, block.timestamp);
        vm.stopPrank();
        require(o - otf.balanceOf(actor) == used && used <= amount, "sell input");
        require(
            (native ? recipient.balance : weth.balanceOf(recipient)) - beforeOut == out && out >= 1,
            "sell recipient"
        );
        hasSwapped = true;
        successfulRouterSwaps++;
        successes[msg.sig]++;
        _observePhase();
    }

    function addLiquidity(uint256 seed) public {
        if (launch.phase() != OTFLaunchManager.Phase.Graduated) {
            noOps[msg.sig]++;
            return;
        }
        uint128 amount = uint128(_bound(seed, 1, 2 ether));
        otf.mint(address(this), 20_000_000 ether);
        weth.mint(address(this), 20 ether);
        otf.approve(address(externalLp), type(uint256).max);
        weth.approve(address(externalLp), type(uint256).max);
        // The upstream LP helper assumes an add has only debits. Collect donation fees first.
        if (externalLiquidity != 0) {
            externalLp.modifyLiquidity(
                _key(),
                ModifyLiquidityParams(-887_272, 887_272, 0, bytes32("invariant lp")),
                bytes("")
            );
        }
        externalLp.modifyLiquidity(
            _key(),
            ModifyLiquidityParams(
                -887_272, 887_272, int256(uint256(amount)), bytes32("invariant lp")
            ),
            bytes("")
        );
        externalLiquidity += amount;
        successes[msg.sig]++;
        _observePhase();
    }

    function rejectPrematureLiquidity(uint256 seed) public {
        if (launch.phase() == OTFLaunchManager.Phase.Graduated) {
            noOps[msg.sig]++;
            return;
        }
        Snapshot memory beforeState = _snapshot();
        ModifyLiquidityParams memory p = ModifyLiquidityParams(
            -887_272, 887_272, int256(_bound(seed, 1, 2 ether)), bytes32("invariant lp")
        );
        _rejected(
            address(externalLp),
            abi.encodeWithSignature(
                "modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)",
                _key(),
                p,
                bytes("")
            ),
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(launch),
                IHooks.beforeAddLiquidity.selector,
                abi.encodeWithSelector(OTFLaunchManager.UnauthorizedLiquidityAddition.selector),
                abi.encodePacked(Hooks.HookCallFailed.selector)
            )
        );
        _assertCoreRollback(beforeState);
    }

    function removeLiquidity(uint256 seed) public {
        if (externalLiquidity == 0) {
            noOps[msg.sig]++;
            return;
        }
        uint128 amount = uint128(_bound(seed, 1, externalLiquidity));
        externalLp.modifyLiquidity(
            _key(),
            ModifyLiquidityParams(
                -887_272, 887_272, -int256(uint256(amount)), bytes32("invariant lp")
            ),
            bytes("")
        );
        externalLiquidity -= amount;
        successes[msg.sig]++;
        _observePhase();
    }

    function donate(uint256 seed) public {
        if (stateView.getLiquidity(PoolId.wrap(launch.poolId())) == 0) {
            noOps[msg.sig]++;
            return;
        }
        uint256 amount0 = _bound(seed, 1, 1e12);
        uint256 amount1 = _bound(seed >> 64, 1, 1e12);
        otf.mint(address(this), amount0 + amount1);
        weth.mint(address(this), amount0 + amount1);
        otf.approve(address(donor), amount0 + amount1);
        weth.approve(address(donor), amount0 + amount1);
        donor.donate(_key(), amount0, amount1, bytes(""));
        successes[msg.sig]++;
        _observePhase();
    }

    function directPoolManagerSwap(uint256 seed) public {
        if (launch.phase() == OTFLaunchManager.Phase.GraduationReady) {
            noOps[msg.sig]++;
            return;
        }
        bool buy = seed & 1 == 0;
        hasSwapped = true;
        bool graduated = launch.phase() == OTFLaunchManager.Phase.Graduated;
        // Bootstrap direct swaps buy to the exact boundary; post-graduation swaps use full range.
        if (!graduated) buy = true;
        uint256 amount = _bound(seed >> 1, 1e12, buy ? 12 ether : 1_000_000 ether);
        otf.mint(address(this), buy ? 0 : amount);
        weth.mint(address(this), buy ? amount : 0);
        otf.approve(address(swapper), amount);
        weth.approve(address(swapper), amount);
        bool zeroForOne = buy != direct;
        uint160 limit = graduated
            ? (zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1)
            : launch.finalSqrtPriceX96();
        swapper.swap(
            _key(),
            SwapParams(zeroForOne, -int256(amount), limit),
            PoolSwapTest.TestSettings(false, false),
            bytes("")
        );
        successes[msg.sig]++;
        _observePhase();
    }

    function attemptFinalization() public {
        if (launch.phase() != OTFLaunchManager.Phase.GraduationReady) {
            noOps[msg.sig]++;
            return;
        }
        launch.finalizeGraduation();
        successes[msg.sig]++;
        _observePhase();
    }

    function rejectInvalid(uint256 seed) public {
        Snapshot memory beforeState = _snapshot();
        if (seed & 1 == 0) {
            uint256 deadline = block.timestamp - 1;
            _rejected(
                address(router),
                abi.encodeCall(router.buyOtfWithWeth, (1 ether, 1, address(this), deadline)),
                abi.encodeWithSelector(OTFLaunchRouter.DeadlinePassed.selector, deadline)
            );
        } else if (launch.phase() != OTFLaunchManager.Phase.GraduationReady) {
            _rejected(
                address(launch),
                abi.encodeCall(launch.finalizeGraduation, ()),
                abi.encodeWithSelector(
                    OTFLaunchManager.InvalidPhase.selector,
                    OTFLaunchManager.Phase.GraduationReady,
                    launch.phase()
                )
            );
        } else {
            noOps[msg.sig]++;
        }
        _assertCoreRollback(beforeState);
    }

    function warpAndRoll(uint256 seed) public {
        vm.warp(block.timestamp + seed % 30 days);
        vm.roll(block.number + (seed >> 64) % 1_000);
        successes[msg.sig]++;
        _observePhase();
    }

    function reachReady() public {
        require(launch.phase() == OTFLaunchManager.Phase.BootstrapActive, "ready fixture phase");
        directPoolManagerSwap(24 ether - 2e12);
        require(launch.phase() == OTFLaunchManager.Phase.GraduationReady, "ready unreachable");
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

    OTFLaunchV4Handler internal _directHandler;
    OTFLaunchV4Handler internal _inverseHandler;

    function setUp() public virtual {
        vm.warp(1_000_000);
        _directHandler = _deploy(true, address(0x1000), address(0x2000));
        _inverseHandler = _deploy(false, address(0x4000), address(0x3000));
        targetContract(address(_directHandler));
        targetContract(address(_inverseHandler));
        targetSelector(FuzzSelector(address(_directHandler), _directHandler.selectors()));
        targetSelector(FuzzSelector(address(_inverseHandler), _inverseHandler.selectors()));
    }

    function afterInvariant() public {
        _directHandler.report(_directHandler.selectors());
        _inverseHandler.report(_inverseHandler.selectors());
    }

    function testBootstrapActionsAreReachable() public {
        // Each specialized fixture exercises only its own reachable phase.
        if (_directHandler.launch().phase() != OTFLaunchManager.Phase.BootstrapActive) return;
        _directHandler.buyWithWeth(0.1 ether);
        _inverseHandler.buyWithNative(0.1 ether);
        _directHandler.sellOtf(2 ether);
        _inverseHandler.sellOtf(3 ether);
        assertGt(_directHandler.successes(_directHandler.sellOtf.selector), 0);
        assertGt(_inverseHandler.successes(_inverseHandler.sellOtf.selector), 0);
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
        if (_directHandler.launch().phase() != OTFLaunchManager.Phase.Graduated) {
            assertEq(_directHandler.externalLiquidity(), 0);
        }
        if (_inverseHandler.launch().phase() != OTFLaunchManager.Phase.Graduated) {
            assertEq(_inverseHandler.externalLiquidity(), 0);
        }
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
            uint160 finalPrice = launch.finalSqrtPriceX96();
            (uint160 lower, uint160 upper) = launch.bootstrapSqrtPriceBounds();
            if (!handler.hasSwapped()) assertEq(price, launch.initialSqrtPriceX96());
            else assertTrue(price >= lower && price <= upper);
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
        assertEq(handler.otf().balanceOf(address(handler.router())), 17);
        assertEq(handler.weth().balanceOf(address(handler.router())), 19);
        assertEq(address(handler.router()).balance, 23);
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
        otf.mint(address(router), 17);
        weth.mint(address(router), 19);
        vm.deal(address(router), 23);
        vm.deal(address(weth), 1_000_000 ether);
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

contract OTFLaunchV4ReadyInvariantTest is OTFLaunchV4InvariantTest {
    function setUp() public override {
        super.setUp();
        _directHandler.reachReady();
        _inverseHandler.reachReady();
    }
}

contract OTFLaunchV4GraduatedInvariantTest is OTFLaunchV4InvariantTest {
    function setUp() public override {
        super.setUp();
        _directHandler.reachReady();
        _inverseHandler.reachReady();
        _directHandler.attemptFinalization();
        _inverseHandler.attemptFinalization();
        _directHandler.addLiquidity(1e12);
        _inverseHandler.addLiquidity(1e12);
        _directHandler.directPoolManagerSwap(1e15);
        _inverseHandler.directPoolManagerSwap(1e15);
    }
}
