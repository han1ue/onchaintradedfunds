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
        launch.afterSwap(
            address(this),
            key,
            UniswapV4SwapParams({ zeroForOne: false, amountSpecified: 1, sqrtPriceLimitX96: 0 }),
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
    uint256 public bootstrapPayout = 4.5 ether;

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
        weth.mint(address(positionManager), 4.5 ether);

        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        launch = _deployLaunch(deployer);
        assertTrue(launch.hookPermissionsValid());
        vm.prank(HOLDER);
        token.transfer(address(launch), 200_000_000 ether);
    }

    function _mineLaunchAddress(OTFLaunchManagerDeployer deployer)
        private
        view
        returns (bytes32 salt, address predicted)
    {
        bytes memory initCode = abi.encodePacked(
            type(OTFLaunchManager).creationCode,
            abi.encode(
                address(token),
                address(weth),
                address(poolManager),
                address(stateView),
                address(positionManager),
                address(permit2)
            )
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
        (bytes32 salt, address predicted) = _mineLaunchAddress(deployer);
        deployed = deployer.deploy(
            salt,
            address(token),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
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
        (bytes32 salt, address predicted) = _mineLaunchAddress(deployer);
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

    function testOneSidedBootstrapAndPermissionlessGraduationLockPermanentLiquidity() public {
        launch.initializeLaunch();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.BootstrapActive));
        assertEq(launch.LP_FEE(), 0);
        assertEq(uint256(uint24(launch.TICK_SPACING())), 1);
        assertEq(token.balanceOf(address(launch)), 50_000_000 ether);
        assertEq(weth.balanceOf(address(launch)), 0);
        assertEq(token.balanceOf(address(positionManager)), 150_000_000 ether);

        poolManager.reachGraduation(launch);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.GraduationReady));
        (uint256 progressBps,, uint256 remaining, uint256 raised) = launch.bootstrapProgress();
        assertEq(progressBps, 10_000);
        assertEq(remaining, 0);
        assertApproxEqAbs(raised, 4.5 ether, 1e15);

        vm.prank(address(0xF1A1));
        launch.finalizeGraduation();
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
        assertEq(launch.permanentOtfLiquidity(), 50_000_000 ether);
        assertEq(launch.permanentWethLiquidity(), 4.5 ether);
        assertEq(token.balanceOf(address(launch)), 0);
        assertEq(weth.balanceOf(address(launch)), 0);
        assertGt(launch.graduationBlock(), 0);

        (bool success,) =
            address(launch).call(abi.encodeWithSignature("removePermanentLiquidity()"));
        assertFalse(success);
        vm.expectPartialRevert(OTFLaunchManager.InvalidPhase.selector);
        launch.finalizeGraduation();
    }

    function testLaunchReferenceConstantsAndSelectedTickPricesAreDeterministic() public view {
        assertEq(launch.MAX_SUPPLY(), 1_000_000_000 ether);
        assertEq(launch.LAUNCH_REFERENCE_FDV_WEI(), 10 ether);
        assertEq(launch.TARGET_REFERENCE_FDV_WEI(), 90 ether);
        uint256 selectedInitialFdv = launch.initialOtfPriceWethWad() * launch.MAX_SUPPLY() / 1e18;
        uint256 selectedFinalFdv = launch.finalOtfPriceWethWad() * launch.MAX_SUPPLY() / 1e18;
        assertEq(selectedInitialFdv, 10 ether);
        assertApproxEqAbs(selectedFinalFdv, 90 ether, 4e15);
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
