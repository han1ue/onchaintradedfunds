// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OTFToken } from "../../src/OTFToken.sol";
import { OTFLaunchManager } from "../../src/OTFLaunchManager.sol";
import { OTFLaunchManagerDeployer } from "../../src/OTFLaunchManagerDeployer.sol";
import { OTFLaunchRouter } from "../../src/OTFLaunchRouter.sol";
import { TeamMarketCapVesting } from "../../src/TeamMarketCapVesting.sol";
import { FakeETHUSDOracle } from "../../src/mocks/FakeETHUSDOracle.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { TestBase } from "../TestBase.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CurrencySettler } from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { StateView } from "@uniswap/v4-periphery/src/lens/StateView.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { DeployPermit2 } from "permit2/test/utils/DeployPermit2.sol";

contract AtomicVestingSpotManipulator {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencySettler for Currency;
    using TransientStateLibrary for IPoolManager;

    IPoolManager private immutable manager;
    TeamMarketCapVesting private immutable vesting;
    PoolKey private key;
    bool private immutable otfIsCurrency0;
    uint160 private immutable startingSqrtPriceX96;
    int24 private immutable finalTick;

    constructor(
        IPoolManager manager_,
        TeamMarketCapVesting vesting_,
        PoolKey memory key_,
        bool otfIsCurrency0_,
        uint160 startingSqrtPriceX96_,
        int24 finalTick_
    ) {
        manager = manager_;
        vesting = vesting_;
        key = key_;
        otfIsCurrency0 = otfIsCurrency0_;
        startingSqrtPriceX96 = startingSqrtPriceX96_;
        finalTick = finalTick_;
    }

    function manipulate(uint256 flashWethInput) external {
        manager.unlock(abi.encode(flashWethInput));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "ONLY_MANAGER");
        uint256 flashWethInput = abi.decode(data, (uint256));

        BalanceDelta buyDelta = manager.swap(
            key,
            SwapParams({
                zeroForOne: !otfIsCurrency0,
                amountSpecified: -int256(flashWethInput),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    finalTick + (otfIsCurrency0 ? int24(100_000) : -100_000)
                )
            }),
            bytes("")
        );

        // A separate attacker cannot record the transiently inflated spot price.
        vesting.checkpoint();

        int128 otfCredit = otfIsCurrency0 ? buyDelta.amount0() : buyDelta.amount1();
        require(otfCredit > 0, "NO_OTF_CREDIT");
        manager.swap(
            key,
            SwapParams({
                zeroForOne: otfIsCurrency0,
                amountSpecified: -int256(uint256(uint128(otfCredit))),
                sqrtPriceLimitX96: startingSqrtPriceX96
            }),
            bytes("")
        );

        _settleOrTake(key.currency0);
        _settleOrTake(key.currency1);
        return bytes("");
    }

    function _settleOrTake(Currency currency) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta < 0) {
            currency.settle(manager, address(this), uint256(-delta), false);
        } else if (delta > 0) {
            currency.take(manager, address(this), uint256(delta), false);
        }
    }
}

contract TeamVestingSpotManipulationPoCTest is TestBase {
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 11) | (1 << 6);
    address private constant BENEFICIARY = address(0xBEEF);

    OTFToken private otf;
    MockWETH private weth;
    PoolManager private poolManager;
    StateView private stateView;
    IAllowanceTransfer private permit2;
    PositionManager private positionManager;
    OTFLaunchManager private launch;
    PoolKey private key;

    function setUp() public {
        vm.warp(1_000_000);
        otf = new OTFToken(address(this));
        weth = new MockWETH();
        poolManager = new PoolManager(address(this));
        stateView = new StateView(IPoolManager(address(poolManager)));
        permit2 = IAllowanceTransfer((new DeployPermit2()).deployPermit2());
        positionManager = new PositionManager(
            IPoolManager(address(poolManager)),
            permit2,
            100_000,
            IPositionDescriptor(address(0)),
            IWETH9(address(weth))
        );

        OTFLaunchManagerDeployer deployer = new OTFLaunchManagerDeployer();
        (bytes32 salt,) = _mineLaunchAddress(deployer);
        launch = deployer.deploy(
            salt,
            address(otf),
            address(weth),
            address(poolManager),
            address(stateView),
            address(positionManager),
            address(permit2)
        );
        (address currency0, address currency1, uint24 fee, int24 spacing, address hooks) =
            launch.poolKey();
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });

        otf.transfer(address(launch), 200_000_000 ether);
        launch.initializeLaunch();
        OTFLaunchRouter router = new OTFLaunchRouter(address(launch));
        weth.mint(address(this), 20 ether);
        weth.approve(address(router), 20 ether);
        router.buyOtfWithWeth(20 ether, 1, address(this), block.timestamp + 1);
        assertEq(uint256(launch.phase()), uint256(OTFLaunchManager.Phase.Graduated));
    }

    function testAtomicRoundTripCannotCheckpointForBeneficiary() public {
        TeamMarketCapVesting vesting = new TeamMarketCapVesting(
            address(launch), address(new FakeETHUSDOracle()), 1 days, BENEFICIARY
        );
        otf.transfer(address(vesting), 100_000_000 ether);

        AtomicVestingSpotManipulator attacker = new AtomicVestingSpotManipulator(
            IPoolManager(address(poolManager)),
            vesting,
            key,
            launch.otfIsCurrency0(),
            launch.finalSqrtPriceX96(),
            launch.finalTick()
        );
        // Only rounding dust is available; the 100 WETH price move itself is flash-accounted.
        weth.mint(address(attacker), 1 ether);
        otf.transfer(address(attacker), 1 ether);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        attacker.manipulate(100 ether);

        assertEq(vesting.unlockedAmount(), 0);
        assertLt(vesting.liveFdvUsdWad(), 1_000_000 ether);
    }

    function _mineLaunchAddress(OTFLaunchManagerDeployer deployer)
        private
        view
        returns (bytes32 salt, address predicted)
    {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(OTFLaunchManager).creationCode,
                abi.encode(
                    address(otf),
                    address(weth),
                    address(poolManager),
                    address(stateView),
                    address(positionManager),
                    address(permit2)
                )
            )
        );
        for (uint256 i; i < 100_000; i++) {
            bytes32 candidate = bytes32(i);
            address candidateAddress =
                vm.computeCreate2Address(candidate, initCodeHash, address(deployer));
            if (uint160(candidateAddress) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
                return (candidate, candidateAddress);
            }
        }
        revert("HOOK_ADDRESS_NOT_FOUND");
    }
}
