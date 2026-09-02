// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    BasketMintRequest,
    BasketRedeemRequest,
    BasketSwapRequest,
    OTFEntryExitRouter,
    SwapLeg
} from "../../src/OTFEntryExitRouter.sol";
import { UniswapV3Adapter } from "../../src/UniswapV3Adapter.sol";
import { MockStockToken } from "./MockStockToken.sol";
import { MockOTFSettlementFactory, MockOTFSettlementVault } from "./MockOTFSettlement.sol";
import { MockTradeAdapter } from "./MockTradeAdapter.sol";
import { MockWETH } from "./MockWETH.sol";
import { MockUniswapV3Factory } from "./MockUniswapV3Factory.sol";
import { MockUniswapV3Router } from "./MockUniswapV3Router.sol";
import { TestBase } from "../TestBase.sol";

abstract contract AtomicRouterTestBase is TestBase {
    uint256 internal constant ONE = 1e18;
    uint24 internal constant FEE = 3_000;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockStockToken internal input;
    MockWETH internal weth;
    MockStockToken internal assetA;
    MockStockToken internal assetB;
    MockStockToken internal assetC;
    MockStockToken internal assetD;
    MockOTFSettlementFactory internal protocolFactory;
    MockOTFSettlementVault internal sourceVault;
    MockOTFSettlementVault internal targetVault;
    OTFEntryExitRouter internal router;
    MockTradeAdapter internal adapterA;
    MockTradeAdapter internal adapterB;
    MockUniswapV3Factory internal v3Factory;
    MockUniswapV3Router internal venue;
    UniswapV3Adapter internal v3Adapter;

    function _setUpAtomicRouter() internal {
        vm.warp(1_000_000);
        input = new MockStockToken("Input", "IN", 18);
        weth = new MockWETH();
        assetA = new MockStockToken("Asset A", "A", 18);
        assetB = new MockStockToken("Asset B", "B", 18);
        assetC = new MockStockToken("Asset C", "C", 18);
        assetD = new MockStockToken("Asset D", "D", 18);
        protocolFactory = new MockOTFSettlementFactory();

        address[] memory sourceAssets = new address[](2);
        sourceAssets[0] = address(assetA);
        sourceAssets[1] = address(assetB);
        sourceVault = new MockOTFSettlementVault("Source OTF", "SRC", sourceAssets);
        address[] memory targetAssets = new address[](2);
        targetAssets[0] = address(assetC);
        targetAssets[1] = address(assetD);
        targetVault = new MockOTFSettlementVault("Target OTF", "TGT", targetAssets);
        protocolFactory.setVault(address(sourceVault), true);
        protocolFactory.setVault(address(targetVault), true);

        router = new OTFEntryExitRouter(address(protocolFactory), address(this), address(weth));
        sourceVault.setRouter(address(router));
        targetVault.setRouter(address(router));

        adapterA = new MockTradeAdapter(address(router));
        adapterB = new MockTradeAdapter(address(router));
        router.setAdapterApproved(address(adapterA), true);
        router.setAdapterApproved(address(adapterB), true);

        v3Factory = new MockUniswapV3Factory();
        venue = new MockUniswapV3Router();
        venue.setFactory(address(v3Factory));
        v3Adapter = new UniswapV3Adapter(address(router), address(v3Factory), address(venue));
        router.setAdapterApproved(address(v3Adapter), true);

        input.mint(ALICE, 100_000 * ONE);
        sourceVault.seedShares(ALICE, 10_000 * ONE);
        assetA.mint(address(sourceVault), 100_000 * ONE);
        assetB.mint(address(sourceVault), 100_000 * ONE);

        _fundAdapter(adapterA);
        _fundAdapter(adapterB);
        input.mint(address(venue), 1_000_000 * ONE);
        assetA.mint(address(venue), 1_000_000 * ONE);
        assetB.mint(address(venue), 1_000_000 * ONE);
        assetC.mint(address(venue), 1_000_000 * ONE);
        assetD.mint(address(venue), 1_000_000 * ONE);
        weth.mint(address(venue), 1_000_000 * ONE);
        vm.deal(address(weth), 10_000_000 * ONE);

        _setRates(adapterA);
        _setRates(adapterB);
        _createPool(address(input), address(assetC));
        _createPool(address(input), address(assetD));
        _createPool(address(assetA), address(input));
        _createPool(address(assetB), address(input));
        _createPool(address(assetA), address(assetC));
        _createPool(address(assetB), address(assetD));

        vm.startPrank(ALICE);
        input.approve(address(router), type(uint256).max);
        sourceVault.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _fundAdapter(MockTradeAdapter adapter) private {
        input.mint(address(adapter), 1_000_000 * ONE);
        assetA.mint(address(adapter), 1_000_000 * ONE);
        assetB.mint(address(adapter), 1_000_000 * ONE);
        assetC.mint(address(adapter), 1_000_000 * ONE);
        assetD.mint(address(adapter), 1_000_000 * ONE);
        weth.mint(address(adapter), 1_000_000 * ONE);
    }

    function _setRates(MockTradeAdapter adapter) private {
        adapter.setRate(address(input), address(assetA), 1, 1);
        adapter.setRate(address(input), address(assetB), 1, 1);
        adapter.setRate(address(input), address(assetC), 1, 1);
        adapter.setRate(address(input), address(assetD), 1, 1);
        adapter.setRate(address(assetA), address(input), 1, 1);
        adapter.setRate(address(assetB), address(input), 1, 1);
        adapter.setRate(address(assetA), address(assetC), 1, 1);
        adapter.setRate(address(assetB), address(assetD), 1, 1);
        adapter.setRate(address(assetA), address(assetD), 1, 1);
        adapter.setRate(address(weth), address(assetA), 1, 1);
        adapter.setRate(address(weth), address(assetB), 1, 1);
        adapter.setRate(address(weth), address(assetC), 1, 1);
        adapter.setRate(address(weth), address(assetD), 1, 1);
        adapter.setRate(address(assetA), address(weth), 1, 1);
        adapter.setRate(address(assetB), address(weth), 1, 1);
    }

    function _createPool(address tokenA, address tokenB) internal returns (address) {
        return v3Factory.createPool(tokenA, tokenB, FEE);
    }

    function _path(address tokenIn, address tokenOut) internal pure returns (bytes memory) {
        return abi.encodePacked(tokenIn, bytes3(FEE), tokenOut);
    }

    function _leg(
        MockTradeAdapter adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimum
    ) internal pure returns (SwapLeg memory) {
        return SwapLeg({
            adapter: address(adapter),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minimum,
            data: ""
        });
    }

    function _v3Leg(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimum)
        internal
        view
        returns (SwapLeg memory)
    {
        return SwapLeg({
            adapter: address(v3Adapter),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minimum,
            data: _path(tokenIn, tokenOut)
        });
    }

    function _mintRequest(uint256 amountIn, uint256 minShares)
        internal
        view
        returns (BasketMintRequest memory)
    {
        return BasketMintRequest({
            inputToken: address(input),
            vault: address(targetVault),
            amountIn: amountIn,
            minShares: minShares,
            deadline: block.timestamp + 1
        });
    }

    function _redeemRequest(uint256 shares, uint256 minAmountOut)
        internal
        view
        returns (BasketRedeemRequest memory)
    {
        return BasketRedeemRequest({
            vault: address(sourceVault),
            outputToken: address(input),
            shares: shares,
            minAmountOut: minAmountOut,
            deadline: block.timestamp + 1
        });
    }

    function _swapRequest(uint256 shares, uint256 minSharesOut)
        internal
        view
        returns (BasketSwapRequest memory)
    {
        return BasketSwapRequest({
            sourceVault: address(sourceVault),
            targetVault: address(targetVault),
            sharesIn: shares,
            minSharesOut: minSharesOut,
            deadline: block.timestamp + 1
        });
    }

    function _zeroMinimums() internal pure returns (uint256[] memory values) {
        values = new uint256[](2);
    }

    function _assertRouterClean() internal view {
        assertEq(input.balanceOf(address(router)), 0);
        assertEq(assetA.balanceOf(address(router)), 0);
        assertEq(assetB.balanceOf(address(router)), 0);
        assertEq(assetC.balanceOf(address(router)), 0);
        assertEq(assetD.balanceOf(address(router)), 0);
        assertEq(sourceVault.balanceOf(address(router)), 0);
        assertEq(targetVault.balanceOf(address(router)), 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(assetA.allowance(address(router), address(sourceVault)), 0);
        assertEq(assetB.allowance(address(router), address(sourceVault)), 0);
        assertEq(assetC.allowance(address(router), address(targetVault)), 0);
        assertEq(assetD.allowance(address(router), address(targetVault)), 0);
    }
}
