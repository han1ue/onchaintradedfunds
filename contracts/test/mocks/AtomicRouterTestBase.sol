// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    BasketMintRequest,
    BasketRedeemRequest,
    BasketSwapRequest,
    DirectSwapRequest,
    OTFEntryExitRouter,
    V3Swap
} from "../../src/OTFEntryExitRouter.sol";
import { MockStockToken } from "./MockStockToken.sol";
import { MockOTFSettlementFactory, MockOTFSettlementVault } from "./MockOTFSettlement.sol";
import { MockUniswapV3Factory } from "./MockUniswapV3Factory.sol";
import { MockUniswapV3Router } from "./MockUniswapV3Router.sol";
import { TestBase } from "../TestBase.sol";

abstract contract AtomicRouterTestBase is TestBase {
    uint256 internal constant ONE = 1e18;
    uint24 internal constant FEE = 3_000;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockStockToken internal input;
    MockStockToken internal assetA;
    MockStockToken internal assetB;
    MockStockToken internal assetC;
    MockStockToken internal assetD;
    MockOTFSettlementFactory internal protocolFactory;
    MockUniswapV3Factory internal v3Factory;
    MockUniswapV3Router internal venue;
    MockOTFSettlementVault internal sourceVault;
    MockOTFSettlementVault internal targetVault;
    OTFEntryExitRouter internal router;

    function _setUpAtomicRouter() internal {
        vm.warp(1_000_000);
        input = new MockStockToken("Input", "IN", 18);
        assetA = new MockStockToken("Asset A", "A", 18);
        assetB = new MockStockToken("Asset B", "B", 18);
        assetC = new MockStockToken("Asset C", "C", 18);
        assetD = new MockStockToken("Asset D", "D", 18);
        protocolFactory = new MockOTFSettlementFactory();
        v3Factory = new MockUniswapV3Factory();
        venue = new MockUniswapV3Router();
        venue.setFactory(address(v3Factory));

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

        router =
            new OTFEntryExitRouter(address(protocolFactory), address(v3Factory), address(venue));
        sourceVault.setRouter(address(router));
        targetVault.setRouter(address(router));

        input.mint(ALICE, 100_000 * ONE);
        sourceVault.seedShares(ALICE, 10_000 * ONE);
        sourceVault.seedShares(address(venue), 100_000 * ONE);
        targetVault.seedShares(address(venue), 100_000 * ONE);

        assetA.mint(address(sourceVault), 100_000 * ONE);
        assetB.mint(address(sourceVault), 100_000 * ONE);
        assetC.mint(address(targetVault), 100_000 * ONE);
        assetD.mint(address(targetVault), 100_000 * ONE);
        input.mint(address(venue), 1_000_000 * ONE);
        assetA.mint(address(venue), 1_000_000 * ONE);
        assetB.mint(address(venue), 1_000_000 * ONE);
        assetC.mint(address(venue), 1_000_000 * ONE);
        assetD.mint(address(venue), 1_000_000 * ONE);

        _createPool(address(input), address(sourceVault));
        _createPool(address(input), address(targetVault));
        _createPool(address(sourceVault), address(targetVault));
        _createPool(address(input), address(assetA));
        _createPool(address(input), address(assetB));
        _createPool(address(assetA), address(assetC));
        _createPool(address(assetB), address(assetD));
    }

    function _createPool(address tokenA, address tokenB) internal returns (address) {
        return v3Factory.createPool(tokenA, tokenB, FEE);
    }

    function _path(address tokenIn, address tokenOut) internal pure returns (bytes memory) {
        return abi.encodePacked(tokenIn, bytes3(FEE), tokenOut);
    }

    function _leg(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimum)
        internal
        pure
        returns (V3Swap memory)
    {
        return V3Swap({ amountIn: amountIn, minAmountOut: minimum, path: _path(tokenIn, tokenOut) });
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
        assertEq(input.allowance(address(router), address(venue)), 0);
        assertEq(assetA.allowance(address(router), address(venue)), 0);
        assertEq(assetB.allowance(address(router), address(venue)), 0);
        assertEq(assetC.allowance(address(router), address(venue)), 0);
        assertEq(assetD.allowance(address(router), address(venue)), 0);
        assertEq(assetA.allowance(address(router), address(sourceVault)), 0);
        assertEq(assetB.allowance(address(router), address(sourceVault)), 0);
        assertEq(assetC.allowance(address(router), address(targetVault)), 0);
        assertEq(assetD.allowance(address(router), address(targetVault)), 0);
    }
}
