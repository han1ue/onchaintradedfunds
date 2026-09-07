// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { V4Router } from "@uniswap/v4-periphery/src/V4Router.sol";
import { StateView } from "@uniswap/v4-periphery/src/lens/StateView.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { UniswapV4Adapter } from "../src/UniswapV4Adapter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";
import { MockPermit2 } from "./mocks/MockUniswapV4.sol";

/// @dev Minimal Universal Router command dispatch around the pinned, unmodified V4Router.
contract NativeV4CommandRouter is V4Router {
    MockPermit2 private immutable _permit2;
    address private _caller;

    constructor(IPoolManager manager, MockPermit2 permit) V4Router(manager) {
        _permit2 = permit;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
    {
        require(_caller == address(0) && deadline >= block.timestamp, "EXECUTION");
        require(keccak256(commands) == keccak256(hex"10") && inputs.length == 1, "COMMAND");
        _caller = msg.sender;
        _executeActions(inputs[0]);
        _caller = address(0);
    }

    function msgSender() public view override returns (address) {
        return _caller;
    }

    function _pay(Currency currency, address payer, uint256 amount) internal override {
        require(amount <= type(uint160).max, "AMOUNT");
        _permit2.transferFrom(
            payer, address(poolManager), uint160(amount), Currency.unwrap(currency)
        );
    }
}

contract UniswapV4NativeIntegrationTest is AtomicRouterTestBase {
    PoolManager private manager;
    NativeV4CommandRouter private commandRouter;
    UniswapV4Adapter private nativeAdapter;

    receive() external payable { }

    function setUp() public {
        _setUpAtomicRouter();
        manager = new PoolManager(address(this));
        MockPermit2 permit = new MockPermit2();
        commandRouter = new NativeV4CommandRouter(manager, permit);
        StateView stateView = new StateView(manager);
        nativeAdapter = new UniswapV4Adapter(
            address(router),
            address(manager),
            address(stateView),
            address(commandRouter),
            address(permit)
        );
        router.setAdapterApproved(address(nativeAdapter), true);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(manager);
        PoolKey memory key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(address(input)), 3000, 60, IHooks(address(0))
        );
        manager.initialize(key, uint160(1 << 96));
        input.mint(address(this), 1000 ether);
        input.approve(address(lp), type(uint256).max);
        vm.deal(address(this), 1000 ether);
        lp.modifyLiquidity{ value: 1000 ether }(
            key, ModifyLiquidityParams(-600, 600, 10000 ether, bytes32(0)), ""
        );
    }

    function testRealV4NativeSettlementAndPoolManagerPayout() public {
        vm.deal(address(nativeAdapter), 7);
        vm.deal(address(commandRouter), 11);
        weth.mint(address(nativeAdapter), ONE + 13);
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey(Currency.wrap(address(input)), 3000, 60, IHooks(address(0)), "");
        uint256 poolNativeBefore = address(manager).balance;
        vm.prank(address(router));
        uint256 received = nativeAdapter.executeSwap(
            address(weth), address(input), ONE, ONE * 99 / 100, abi.encode(address(0), path)
        );
        assertTrue(received > ONE * 99 / 100);
        assertEq(address(manager).balance, poolNativeBefore + ONE);
        assertEq(weth.balanceOf(address(nativeAdapter)), 13);
        assertEq(address(nativeAdapter).balance, 7);
        assertEq(address(commandRouter).balance, 11);
        vm.prank(address(router));
        input.transfer(address(nativeAdapter), received);
        path[0].intermediateCurrency = Currency.wrap(address(0));
        vm.prank(address(router));
        uint256 returnedWeth = nativeAdapter.executeSwap(
            address(input),
            address(weth),
            received,
            ONE * 99 / 100,
            abi.encode(address(input), path)
        );
        assertTrue(returnedWeth > ONE * 99 / 100);
        assertEq(weth.balanceOf(address(router)), returnedWeth);
        assertEq(weth.balanceOf(address(nativeAdapter)), 13);
        assertEq(address(nativeAdapter).balance, 7);
        assertEq(address(commandRouter).balance, 11);
        assertEq(address(manager).balance, poolNativeBefore + ONE - returnedWeth);
    }
}
