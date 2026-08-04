// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { EntrySwap, ExitSwap, OTFEntryRouter } from "../src/OTFEntryRouter.sol";
import { MockUniswapV3Router } from "../src/mocks/MockUniswapV3Router.sol";
import { UniswapV3Adapter } from "../src/UniswapV3Adapter.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract UniswapV3ProtocolIntegrationTest is ProtocolTestBase {
    MockUniswapV3Router private venue;
    UniswapV3Adapter private v3Adapter;
    OTFEntryRouter private entryRouter;

    function setUp() public override {
        super.setUp();
        venue = new MockUniswapV3Router();
        v3Adapter = new UniswapV3Adapter(address(this), address(venue), address(tokenC), 3000);
        entryRouter = new OTFEntryRouter(address(this), address(factory), address(tokenC));

        factory.setTradeAdapterApproved(address(v3Adapter), true);
        entryRouter.setEntryAdapterApproved(address(v3Adapter), true);
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
            maxSettlementIn: required[0] + ONE,
            adapterData: abi.encode(_path(address(tokenC), address(tokenA)))
        });
        entrySwaps[1] = EntrySwap({
            adapter: address(v3Adapter),
            maxSettlementIn: required[1] + ONE,
            adapterData: abi.encode(_path(address(tokenC), address(tokenB)))
        });
        uint256 maximum = entrySwaps[0].maxSettlementIn + entrySwaps[1].maxSettlementIn;

        vm.startPrank(ALICE);
        tokenC.approve(address(entryRouter), maximum);
        uint256 spent = entryRouter.enterWithSettlement(
            address(vault), shares, ALICE, maximum, block.timestamp + 1 hours, entrySwaps
        );
        vault.approve(address(entryRouter), shares);
        uint256[] memory redeemAmounts = vault.previewRedeem(shares);
        ExitSwap[] memory exitSwaps = new ExitSwap[](2);
        exitSwaps[0] = ExitSwap({
            adapter: address(v3Adapter),
            minSettlementOut: redeemAmounts[0],
            adapterData: abi.encode(_path(address(tokenA), address(tokenC)))
        });
        exitSwaps[1] = ExitSwap({
            adapter: address(v3Adapter),
            minSettlementOut: redeemAmounts[1],
            adapterData: abi.encode(_path(address(tokenB), address(tokenC)))
        });
        uint256 received = entryRouter.redeemToSettlement(
            address(vault),
            shares,
            ALICE,
            redeemAmounts[0] + redeemAmounts[1],
            block.timestamp + 1 hours,
            exitSwaps
        );
        vm.stopPrank();

        assertEq(spent, required[0] + required[1]);
        assertEq(received, redeemAmounts[0] + redeemAmounts[1]);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenC.balanceOf(address(entryRouter)), 0);
        assertEq(tokenC.balanceOf(address(v3Adapter)), 0);
    }

    function testManagerRebalanceUsesV3UsdgHop() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);

        address[] memory path = new address[](3);
        path[0] = address(tokenB);
        path[1] = address(tokenC);
        path[2] = address(tokenA);
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(v3Adapter),
            tokenIn: address(tokenB),
            tokenOut: address(tokenA),
            amountIn: 100 * ONE,
            minAmountOut: 99 * ONE,
            adapterData: abi.encode(path)
        });

        _refreshPrices();
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), 600 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 400 * ONE);
        assertTrue(!vault.strategicRebalanceActive());
        assertEq(tokenB.allowance(address(v3Adapter), address(venue)), 0);
    }

    function _path(address tokenIn, address tokenOut)
        private
        pure
        returns (address[] memory path)
    {
        path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
    }
}
