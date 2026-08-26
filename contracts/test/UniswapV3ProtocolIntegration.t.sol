// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { EntrySwap, ExitSwap, OTFEntryExitRouter } from "../src/OTFEntryExitRouter.sol";
import { MockUniswapV3Router } from "./mocks/MockUniswapV3Router.sol";
import { RegisteredUniswapV3Adapter } from "../src/RegisteredUniswapV3Adapter.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract UniswapV3ProtocolIntegrationTest is ProtocolTestBase {
    MockUniswapV3Router private venue;
    RegisteredUniswapV3Adapter private v3Adapter;
    OTFEntryExitRouter private entryRouter;

    function setUp() public override {
        super.setUp();
        venue = new MockUniswapV3Router();
        v3Adapter = new RegisteredUniswapV3Adapter(address(this), address(venue));
        entryRouter = new OTFEntryExitRouter(address(factory));

        factory.setAdapterPermissions(address(v3Adapter), true, true, true);
        v3Adapter.setCallerApproved(address(executor), true);
        v3Adapter.setCallerApproved(address(entryRouter), true);

        tokenA.mint(address(venue), 10_000 * ONE);
        tokenB.mint(address(venue), 10_000 * ONE);
        tokenC.mint(address(venue), 10_000 * ONE);
        tokenC.mint(ALICE, 10_000 * ONE);
    }

    function testEntryAndRedemptionUseV3SettlementPools() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory required = vault.previewMint(shares);
        EntrySwap[] memory entrySwaps = new EntrySwap[](2);
        entrySwaps[0] = EntrySwap({
            adapter: address(v3Adapter),
            inputAmount: required[0],
            minAssetOut: required[0],
            minRefundInputRate: ONE,
            adapterData: _path(address(tokenC), address(tokenA)),
            refundAdapterData: _path(address(tokenA), address(tokenC))
        });
        entrySwaps[1] = EntrySwap({
            adapter: address(v3Adapter),
            inputAmount: required[1],
            minAssetOut: required[1],
            minRefundInputRate: ONE,
            adapterData: _path(address(tokenC), address(tokenB)),
            refundAdapterData: _path(address(tokenB), address(tokenC))
        });
        uint256 settlementIn = required[0] + required[1];

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), settlementIn);
        (uint256 mintedShares, uint256 settlementRefunded) = entryRouter.enterWithToken(
            address(vault),
            address(tokenC),
            settlementIn,
            shares,
            ALICE,
            block.timestamp + 1 hours,
            entrySwaps
        );
        vault.approve(address(entryRouter), shares);
        uint256[] memory redeemAmounts = vault.previewRedeem(shares);
        ExitSwap[] memory exitSwaps = new ExitSwap[](2);
        exitSwaps[0] = ExitSwap({
            adapter: address(v3Adapter),
            minOutputAmount: redeemAmounts[0],
            adapterData: _path(address(tokenA), address(tokenC))
        });
        exitSwaps[1] = ExitSwap({
            adapter: address(v3Adapter),
            minOutputAmount: redeemAmounts[1],
            adapterData: _path(address(tokenB), address(tokenC))
        });
        uint256 received = entryRouter.redeemToToken(
            address(vault),
            address(tokenC),
            shares,
            ALICE,
            redeemAmounts[0] + redeemAmounts[1],
            block.timestamp + 1 hours,
            exitSwaps
        );
        vm.stopPrank();

        assertEq(mintedShares, shares);
        assertEq(settlementRefunded, 0);
        assertEq(received, redeemAmounts[0] + redeemAmounts[1]);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(v3Adapter)), 0);
    }

    function testManagerRebalanceUsesV3UsdgHop() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);

        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(v3Adapter),
            tokenIn: address(tokenB),
            tokenOut: address(tokenA),
            amountIn: 100 * ONE,
            minAmountOut: 99 * ONE,
            adapterData: abi.encodePacked(
                address(tokenB),
                bytes3(uint24(3_000)),
                address(tokenC),
                bytes3(uint24(500)),
                address(tokenA)
            )
        });

        _refreshPrices();
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), 600 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 400 * ONE);
        assertTrue(!vault.strategicRebalanceActive());
        assertEq(tokenB.allowance(address(v3Adapter), address(venue)), 0);
    }

    function _path(address tokenIn, address tokenOut) private pure returns (bytes memory path) {
        path = abi.encodePacked(tokenIn, bytes3(uint24(3_000)), tokenOut);
    }
}
