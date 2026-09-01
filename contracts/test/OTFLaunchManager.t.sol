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
    MockUniswapV4StateView public stateView;
    UniswapV4PoolKey public key;
    bytes32 public poolId;

    function setStateView(MockUniswapV4StateView stateView_) external {
        stateView = stateView_;
    }

    function initialize(UniswapV4PoolKey calldata key_, uint160 sqrtPriceX96)
        external
        returns (int24 tick)
    {
        key = key_;
        poolId = keccak256(
            abi.encode(key_.currency0, key_.currency1, key_.fee, key_.tickSpacing, key_.hooks)
        );
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
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant AFTER_SWAP_FLAG = 1 << 6;

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
        bytes32 salt;
        for (uint256 i = 0; i < 100_000; i++) {
            bytes32 candidate = bytes32(i);
            address predicted = vm.computeCreate2Address(candidate, initCodeHash, address(deployer));
            if (uint160(predicted) & ALL_HOOK_MASK == AFTER_SWAP_FLAG) {
                salt = candidate;
                break;
            }
        }
        launch = deployer.deploy(
            salt,
            address(token),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        assertTrue(launch.hookPermissionsValid());
        vm.prank(HOLDER);
        token.transfer(address(launch), 200_000_000 ether);
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
