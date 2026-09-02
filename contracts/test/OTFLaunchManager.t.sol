// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OTFLaunchManager } from "../src/OTFLaunchManager.sol";
import { OTFLaunchManagerDeployer } from "../src/OTFLaunchManagerDeployer.sol";
import { OTFToken } from "../src/OTFToken.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    UniswapV4PoolKey,
    UniswapV4SwapParams
} from "../src/interfaces/IUniswapV4.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { MockPermit2, MockUniswapV4StateView } from "./mocks/MockUniswapV4.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { TestBase } from "./TestBase.sol";

contract MockLaunchPoolManager {
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant BEFORE_INITIALIZE_FLAG = 1 << 13;

    error HookAddressNotValid(address hooks);
    error InvalidHookResponse();
    error PoolAlreadyInitialized();

    MockUniswapV4StateView public stateView;
    UniswapV4PoolKey public key;
    bytes32 public poolId;
    mapping(bytes32 id => bool initialized) public isInitialized;
    uint256 public beforeInitializeCalls;

    function setStateView(MockUniswapV4StateView stateView_) external {
        stateView = stateView_;
    }

    function initialize(UniswapV4PoolKey calldata key_, uint160 sqrtPriceX96)
        external
        returns (int24 tick)
    {
        uint160 hookFlags = uint160(key_.hooks) & ALL_HOOK_MASK;
        if (key_.hooks != address(0) && hookFlags == 0) {
            revert HookAddressNotValid(key_.hooks);
        }
        if (key_.hooks != msg.sender && hookFlags & BEFORE_INITIALIZE_FLAG != 0) {
            beforeInitializeCalls++;
            (bool success, bytes memory result) = key_.hooks
                .call(
                    abi.encodeWithSelector(
                        OTFLaunchManager.beforeInitialize.selector, msg.sender, key_, sqrtPriceX96
                    )
                );
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
            if (
                result.length != 32
                    || abi.decode(result, (bytes4)) != OTFLaunchManager.beforeInitialize.selector
            ) {
                revert InvalidHookResponse();
            }
        }

        bytes32 id = keccak256(
            abi.encode(key_.currency0, key_.currency1, key_.fee, key_.tickSpacing, key_.hooks)
        );
        if (isInitialized[id]) revert PoolAlreadyInitialized();
        isInitialized[id] = true;
        key = key_;
        poolId = id;
        tick = OTFLaunchManager(key_.hooks).initialTick();
        stateView.setPoolState(poolId, sqrtPriceX96, tick);
    }

    function reachGraduation(OTFLaunchManager launch) external {
        int24 tick = launch.finalTick();
        stateView.setPoolState(poolId, launch.finalSqrtPriceX96(), tick);
        _recordSwap(launch);
    }

    function moveBootstrap(OTFLaunchManager launch, uint160 sqrtPriceX96, int24 tick) external {
        stateView.setPoolState(poolId, sqrtPriceX96, tick);
        _recordSwap(launch);
    }

    function _recordSwap(OTFLaunchManager launch) private {
        launch.afterSwap(
            address(this),
            key,
            UniswapV4SwapParams({
                zeroForOne: !launch.otfIsCurrency0(), amountSpecified: 1, sqrtPriceLimitX96: 0
            }),
            0,
            ""
        );
    }
}

contract MockValidBeforeInitializeHook {
    function beforeInitialize(address, UniswapV4PoolKey calldata, uint160)
        external
        pure
        returns (bytes4)
    {
        return this.beforeInitialize.selector;
    }

    function initialTick() external pure returns (int24) {
        return 0;
    }
}

contract MockInvalidBeforeInitializeHook {
    function beforeInitialize(address, UniswapV4PoolKey calldata, uint160)
        external
        pure
        returns (bytes4)
    {
        return bytes4(0);
    }

    function initialTick() external pure returns (int24) {
        return 0;
    }
}

contract MockLaunchPositionManager is IUniswapV4PositionManager {
    using SafeTransferLib for address;

    address public immutable poolManager;
    IPermit2AllowanceTransfer public immutable permit2;
    uint256 public nextTokenId = 1;
    address public weth;
    uint256 public bootstrapPayout = 8_999_934_702_040_754_827;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = IPermit2AllowanceTransfer(permit2_);
    }

    function setWeth(address weth_) external {
        weth = weth_;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        if (keccak256(actions) == keccak256(hex"020d")) {
            (
                UniswapV4PoolKey memory key,
                int24 tickLower,
                int24 tickUpper,
                uint256 liquidity,
                uint128 amount0Max,
                uint128 amount1Max,
                address recipient,
                bytes memory hookData
            ) = abi.decode(
                params[0],
                (UniswapV4PoolKey, int24, int24, uint256, uint128, uint128, address, bytes)
            );
            tickLower;
            tickUpper;
            liquidity;
            recipient;
            hookData;
            if (amount0Max != 0) {
                permit2.transferFrom(msg.sender, address(this), uint160(amount0Max), key.currency0);
            }
            if (amount1Max != 0) {
                permit2.transferFrom(msg.sender, address(this), uint160(amount1Max), key.currency1);
            }
            nextTokenId++;
            return;
        }
        require(keccak256(actions) == keccak256(hex"0311"), "ACTIONS");
        weth.safeTransfer(msg.sender, bootstrapPayout);
    }
}

contract OTFLaunchManagerTest is TestBase {
    address private constant HOLDER = address(0xA11CE);
    address private constant ATTACKER = address(0xBAD);
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint160 private constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 private constant REQUIRED_HOOK_FLAGS = BEFORE_INITIALIZE_FLAG | AFTER_SWAP_FLAG;
    uint256 private constant EXPECTED_BOOTSTRAP_WETH_PROCEEDS = 8_999_934_702_040_754_827;

    OTFToken private token;
    MockStockToken private weth;
    MockPermit2 private permit2;
    MockLaunchPoolManager private poolManager;
    MockUniswapV4StateView private stateView;
    MockLaunchPositionManager private positionManager;
    OTFLaunchManager private launch;

    function setUp() public {
        token = new OTFToken(HOLDER);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        permit2 = new MockPermit2();
        poolManager = new MockLaunchPoolManager();
        stateView = new MockUniswapV4StateView(address(poolManager));
        poolManager.setStateView(stateView);
        positionManager = new MockLaunchPositionManager(address(poolManager), address(permit2));
        positionManager.setWeth(address(weth));
        weth.mint(address(positionManager), EXPECTED_BOOTSTRAP_WETH_PROCEEDS);

        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        launch = _deployLaunch(deployer);
        assertTrue(launch.hookPermissionsValid());
        vm.prank(HOLDER);
        token.transfer(address(launch), 200_000_000 ether);
    }

    function _mineLaunchAddress(
        OTFLaunchManagerDeployer deployer,
        address otf_,
        address weth_,
        address poolManager_,
        address stateView_,
        address positionManager_,
        address permit2_
    ) private pure returns (bytes32 salt, address predicted) {
        bytes memory initCode = abi.encodePacked(
            type(OTFLaunchManager).creationCode,
            abi.encode(otf_, weth_, poolManager_, stateView_, positionManager_, permit2_)
        );
        bytes32 initCodeHash = keccak256(initCode);
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

    function _deployLaunch(OTFLaunchManagerDeployer deployer)
        private
        returns (OTFLaunchManager deployed)
    {
        return _deployLaunchFor(
            deployer,
            address(token),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
    }

    function _deployLaunchFor(
        OTFLaunchManagerDeployer deployer,
        address otf_,
        address weth_,
        address poolManager_,
        address stateView_,
        address positionManager_,
        address permit2_
    ) private returns (OTFLaunchManager deployed) {
        (bytes32 salt, address predicted) = _mineLaunchAddress(
            deployer, otf_, weth_, poolManager_, stateView_, positionManager_, permit2_
        );
        deployed = deployer.deploy(
            salt, otf_, weth_, poolManager_, stateView_, positionManager_, permit2_
        );
        assertEq(address(deployed), predicted);
    }

    function _poolKey(address hooks) private view returns (UniswapV4PoolKey memory key) {
        (address currency0, address currency1) = address(token) < address(weth)
            ? (address(token), address(weth))
            : (address(weth), address(token));
        key = UniswapV4PoolKey({
            currency0: currency0, currency1: currency1, fee: 0, tickSpacing: 1, hooks: hooks
        });
    }

    function _deployedPoolKey(OTFLaunchManager manager)
        private
        view
        returns (UniswapV4PoolKey memory key)
    {
        (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) =
            manager.poolKey();
        key = UniswapV4PoolKey(currency0, currency1, fee, tickSpacing, hooks);
    }

    function _deployOrderedLaunch(bool otfIsCurrency0_)
        private
        returns (
            OTFLaunchManager orderedLaunch,
            MockStockToken orderedOtf,
            MockLaunchPoolManager orderedPoolManager
        )
    {
        MockStockToken first = new MockStockToken("First", "FIRST", 18);
        MockStockToken second = new MockStockToken("Second", "SECOND", 18);
        MockStockToken lower = address(first) < address(second) ? first : second;
        MockStockToken higher = address(first) < address(second) ? second : first;
        orderedOtf = otfIsCurrency0_ ? lower : higher;
        MockStockToken orderedWeth = otfIsCurrency0_ ? higher : lower;

        MockPermit2 orderedPermit2 = new MockPermit2();
        orderedPoolManager = new MockLaunchPoolManager();
        MockUniswapV4StateView orderedStateView =
            new MockUniswapV4StateView(address(orderedPoolManager));
        orderedPoolManager.setStateView(orderedStateView);
        MockLaunchPositionManager orderedPositionManager =
            new MockLaunchPositionManager(address(orderedPoolManager), address(orderedPermit2));
        orderedPositionManager.setWeth(address(orderedWeth));
        orderedWeth.mint(address(orderedPositionManager), EXPECTED_BOOTSTRAP_WETH_PROCEEDS);

        orderedLaunch = _deployLaunchFor(
            new OTFLaunchManagerDeployer(),
            address(orderedOtf),
            address(orderedWeth),
            address(orderedPoolManager),
            address(orderedStateView),
            address(orderedPositionManager),
            address(orderedPermit2)
        );
        orderedOtf.mint(address(orderedLaunch), 200_000_000 ether);
        orderedLaunch.initializeLaunch();
    }

    function testExpectedHookMaskIsExactlyBeforeInitializeAndAfterSwap() public {
        assertEq(uint256(uint160(address(launch)) & ALL_HOOK_MASK), uint256(REQUIRED_HOOK_FLAGS));
        assertEq(uint256(REQUIRED_HOOK_FLAGS), 0x2040);

        UniswapV4PoolKey memory invalidKey = _poolKey(address(uint160(1 << 14)));
        uint160 sqrtPriceX96 = launch.initialSqrtPriceX96();
        vm.expectPartialRevert(MockLaunchPoolManager.HookAddressNotValid.selector);
        poolManager.initialize(invalidKey, sqrtPriceX96);
    }

    function testPoolManagerModelsHookCallbacksAndNoSelfCall() public {
        uint160 sqrtPriceX96 = launch.initialSqrtPriceX96();
        address validHook = address(uint160((1 << 20) | REQUIRED_HOOK_FLAGS));
        MockValidBeforeInitializeHook validImplementation = new MockValidBeforeInitializeHook();
        vm.etch(validHook, address(validImplementation).code);
        poolManager.initialize(_poolKey(validHook), sqrtPriceX96);
        assertEq(poolManager.beforeInitializeCalls(), 1);

        address invalidHook = address(uint160((2 << 20) | REQUIRED_HOOK_FLAGS));
        MockInvalidBeforeInitializeHook invalidImplementation =
            new MockInvalidBeforeInitializeHook();
        vm.etch(invalidHook, address(invalidImplementation).code);
        vm.expectRevert(MockLaunchPoolManager.InvalidHookResponse.selector);
        poolManager.initialize(_poolKey(invalidHook), sqrtPriceX96);

        vm.prank(invalidHook);
        poolManager.initialize(_poolKey(invalidHook), sqrtPriceX96);
        assertEq(poolManager.beforeInitializeCalls(), 1);
    }

    function testAttackerCannotInitializeCanonicalPoolAfterManagerDeployment() public {
        UniswapV4PoolKey memory key = _deployedPoolKey(launch);
        uint160 sqrtPriceX96 = launch.initialSqrtPriceX96();
        vm.prank(ATTACKER);
        vm.expectPartialRevert(OTFLaunchManager.UnauthorizedInitializer.selector);
        poolManager.initialize(key, sqrtPriceX96);

        launch.initializeLaunch();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));

        vm.prank(address(launch));
        vm.expectRevert(MockLaunchPoolManager.PoolAlreadyInitialized.selector);
        poolManager.initialize(key, sqrtPriceX96);
    }

    function testAttackerCannotInitializePredictedPoolBeforeManagerDeployment() public {
        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        (bytes32 salt, address predicted) = _mineLaunchAddress(
            deployer,
            address(token),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        UniswapV4PoolKey memory key = _poolKey(predicted);
        uint160 sqrtPriceX96 = launch.initialSqrtPriceX96();

        vm.prank(ATTACKER);
        vm.expectRevert(MockLaunchPoolManager.InvalidHookResponse.selector);
        poolManager.initialize(key, sqrtPriceX96);

        OTFLaunchManager predictedLaunch = deployer.deploy(
            salt,
            address(token),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        assertEq(address(predictedLaunch), predicted);
        vm.prank(HOLDER);
        token.transfer(address(predictedLaunch), 200_000_000 ether);
        predictedLaunch.initializeLaunch();
        assertEq(uint256(predictedLaunch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
    }

    function testOneSidedBootstrapAndPermissionlessDustSafeGraduationLockPermanentLiquidity()
        public
    {
        launch.initializeLaunch();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(launch.LP_FEE(), 0);
        assertEq(uint256(uint24(launch.TICK_SPACING())), 1);
        assertEq(token.balanceOf(address(launch)), 50_000_000 ether);
        assertEq(weth.balanceOf(address(launch)), 0);
        assertEq(token.balanceOf(address(positionManager)), 150_000_000 ether);
        vm.prank(HOLDER);
        assertTrue(token.transfer(address(launch), 123));
        weth.mint(address(launch), 1);

        poolManager.reachGraduation(launch);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
        (uint256 progressBps,, uint256 remaining, uint256 raised) = launch.bootstrapProgress();
        assertEq(progressBps, 10_000);
        assertEq(remaining, 0);
        assertEq(raised, EXPECTED_BOOTSTRAP_WETH_PROCEEDS);

        vm.prank(address(0xF1A1));
        launch.finalizeGraduation();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
        assertEq(launch.bootstrapWethProceeds(), EXPECTED_BOOTSTRAP_WETH_PROCEEDS);
        assertEq(launch.permanentOtfLiquidity(), 50_000_000 ether);
        assertApproxEqAbs(launch.permanentWethLiquidity(), 9 ether, 1e15);
        assertEq(token.balanceOf(address(launch)), 123);
        assertEq(weth.balanceOf(address(launch)), 0);
        assertGt(launch.graduationBlock(), 0);
        (uint256 otfDust, uint256 wethDust) = launch.lockedDustBalances();
        assertEq(otfDust, 123);
        assertEq(wethDust, 0);

        (bool success,) =
            address(launch).call(abi.encodeWithSignature("removePermanentLiquidity()"));
        assertFalse(success);
        vm.expectPartialRevert(OTFLaunchManager.InvalidPhase.selector);
        launch.finalizeGraduation();
    }

    function testLaunchReferenceConstantsAllocationsAndSelectedTickPriceAreDeterministic()
        public
        view
    {
        assertEq(launch.MAX_SUPPLY(), 1_000_000_000 ether);
        assertEq(token.MAX_SUPPLY(), 1_000_000_000 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(launch.BOOTSTRAP_ALLOCATION(), 150_000_000 ether);
        assertEq(launch.PERMANENT_LIQUIDITY_RESERVE(), 50_000_000 ether);
        assertEq(launch.REQUIRED_OTF_BALANCE(), 200_000_000 ether);
        assertEq(
            150_000_000 ether + 50_000_000 ether + 100_000_000 ether + 700_000_000 ether,
            launch.MAX_SUPPLY()
        );
        assertEq(launch.LAUNCH_REFERENCE_FDV_WEI(), 20 ether);
        assertEq(launch.TARGET_REFERENCE_FDV_WEI(), 180 ether);
        uint256 selectedInitialFdv = launch.initialOtfPriceWethWad() * launch.MAX_SUPPLY() / 1e18;
        uint256 selectedFinalFdv = launch.finalOtfPriceWethWad() * launch.MAX_SUPPLY() / 1e18;
        assertEq(selectedInitialFdv, 20 ether);
        assertEq(selectedFinalFdv, 179_997_388_091_000_000_000);
        assertApproxEqAbs(selectedFinalFdv, 180 ether, 3e15);
    }

    function testBootstrapProgressAndBuybacksWorkInBothCurrencyOrderings() public {
        _assertBootstrapProgressAndBuyback(true);
        _assertBootstrapProgressAndBuyback(false);
    }

    function _assertBootstrapProgressAndBuyback(bool otfIsCurrency0_) private {
        (OTFLaunchManager orderedLaunch,, MockLaunchPoolManager orderedPoolManager) =
            _deployOrderedLaunch(otfIsCurrency0_);
        assertEq(orderedLaunch.otfIsCurrency0(), otfIsCurrency0_);
        assertEq(orderedLaunch.initialOtfPriceWethWad(), 20_000_000_000);
        assertEq(orderedLaunch.finalOtfPriceWethWad(), 179_997_388_091);
        if (otfIsCurrency0_) {
            assertTrue(orderedLaunch.initialTick() == -177_284);
            assertTrue(orderedLaunch.finalTick() == -155_311);
            assertEq(orderedLaunch.initialSqrtPriceX96(), 11_204_554_194_957_227_983_746_388);
            assertEq(orderedLaunch.finalSqrtPriceX96(), 33_613_418_706_697_289_737_079_801);
        } else {
            assertTrue(orderedLaunch.initialTick() == 177_284);
            assertTrue(orderedLaunch.finalTick() == 155_311);
            assertEq(
                orderedLaunch.initialSqrtPriceX96(), 560_227_709_747_861_399_187_319_382_274_581
            );
            assertEq(orderedLaunch.finalSqrtPriceX96(), 186_743_924_804_530_596_371_038_112_052_313);
        }

        (uint256 progressBps,, uint256 remaining, uint256 raised) =
            orderedLaunch.bootstrapProgress();
        assertEq(progressBps, 0);
        assertLe(150_000_000 ether - remaining, 100_000);
        assertEq(raised, 0);

        int24 midpointTick = otfIsCurrency0_
            ? orderedLaunch.initialTick() + 10_986
            : orderedLaunch.initialTick() - 10_986;
        uint160 midpointSqrtPriceX96 = uint160(
            (uint256(orderedLaunch.initialSqrtPriceX96())
                    + uint256(orderedLaunch.finalSqrtPriceX96())) / 2
        );
        orderedPoolManager.moveBootstrap(orderedLaunch, midpointSqrtPriceX96, midpointTick);
        (progressBps,,, raised) = orderedLaunch.bootstrapProgress();
        assertGt(progressBps, 0);
        assertLt(progressBps, 10_000);
        assertGt(raised, 0);
        assertEq(uint256(orderedLaunch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));

        orderedPoolManager.reachGraduation(orderedLaunch);
        (progressBps,, remaining, raised) = orderedLaunch.bootstrapProgress();
        assertEq(progressBps, 10_000);
        assertEq(remaining, 0);
        assertEq(raised, EXPECTED_BOOTSTRAP_WETH_PROCEEDS);
        assertEq(uint256(orderedLaunch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
    }

    function testDonatedWethDustCannotBlockInitialization() public {
        weth.mint(address(launch), 1);
        launch.initializeLaunch();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        (uint256 otfDust, uint256 wethDust) = launch.lockedDustBalances();
        assertEq(otfDust, 50_000_000 ether);
        assertEq(wethDust, 1);
    }
}
