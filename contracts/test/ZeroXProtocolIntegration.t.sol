// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { EntrySwap, ExitSwap, OTFEntryRouter } from "../src/OTFEntryRouter.sol";
import { MockZeroXAllowanceHolder } from "../src/mocks/MockZeroXAllowanceHolder.sol";
import { MockZeroXTarget } from "../src/mocks/MockZeroXTarget.sol";
import { ZeroXSwapAdapter } from "../src/ZeroXSwapAdapter.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ZeroXProtocolIntegrationTest is ProtocolTestBase {
    MockZeroXTarget private venue;
    MockZeroXAllowanceHolder private allowanceHolder;
    ZeroXSwapAdapter private zeroXAdapter;
    OTFEntryRouter private entryRouter;

    function setUp() public override {
        super.setUp();
        venue = new MockZeroXTarget();
        allowanceHolder = new MockZeroXAllowanceHolder(address(venue));
        venue.setAllowanceTarget(address(allowanceHolder));
        zeroXAdapter = new ZeroXSwapAdapter(
            address(this), address(venue), address(allowanceHolder), address(tokenC)
        );
        entryRouter = new OTFEntryRouter(address(this), address(factory), address(tokenC));

        factory.setTradeAdapterApproved(address(zeroXAdapter), true);
        entryRouter.setEntryAdapterApproved(address(zeroXAdapter), true);
        zeroXAdapter.setCallerApproved(address(executor), true);
        zeroXAdapter.setCallerApproved(address(entryRouter), true);

        tokenA.mint(address(venue), 10_000 * ONE);
        tokenB.mint(address(venue), 10_000 * ONE);
        tokenC.mint(address(venue), 10_000 * ONE);
        tokenC.mint(ALICE, 10_000 * ONE);
    }

    function testEntryAndRedemptionUseApprovedZeroXAdapter() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory required = vault.previewMint(shares);
        EntrySwap[] memory entrySwaps = new EntrySwap[](2);
        entrySwaps[0] = EntrySwap({
            adapter: address(zeroXAdapter),
            maxSettlementIn: required[0] + ONE,
            adapterData: _fill(
                address(tokenC), address(tokenA), required[0], required[0], address(zeroXAdapter)
            )
        });
        entrySwaps[1] = EntrySwap({
            adapter: address(zeroXAdapter),
            maxSettlementIn: required[1] + ONE,
            adapterData: _fill(
                address(tokenC), address(tokenB), required[1], required[1], address(zeroXAdapter)
            )
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
            adapter: address(zeroXAdapter),
            minSettlementOut: redeemAmounts[0],
            adapterData: _fill(
                address(tokenA),
                address(tokenC),
                redeemAmounts[0],
                redeemAmounts[0],
                address(zeroXAdapter)
            )
        });
        exitSwaps[1] = ExitSwap({
            adapter: address(zeroXAdapter),
            minSettlementOut: redeemAmounts[1],
            adapterData: _fill(
                address(tokenB),
                address(tokenC),
                redeemAmounts[1],
                redeemAmounts[1],
                address(zeroXAdapter)
            )
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
        _assertAdapterClean();
    }

    function testManagerRebalanceUsesFactoryApprovedZeroXAdapter() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);

        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(zeroXAdapter),
            tokenIn: address(tokenB),
            tokenOut: address(tokenA),
            amountIn: 100 * ONE,
            minAmountOut: 99 * ONE,
            adapterData: _fill(
                address(tokenB), address(tokenA), 100 * ONE, 100 * ONE, address(zeroXAdapter)
            )
        });

        _refreshPrices();
        vault.executeRebalanceTrades(trades);

        assertEq(tokenA.balanceOf(address(vault)), 600 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 400 * ONE);
        assertFalse(vault.strategicRebalanceActive());
        _assertAdapterClean();
    }

    function _fill(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 buyAmount,
        address recipient
    ) private pure returns (bytes memory) {
        return abi.encodeCall(
            MockZeroXTarget.fill, (sellToken, buyToken, sellAmount, buyAmount, recipient)
        );
    }

    function _assertAdapterClean() private view {
        assertEq(tokenA.balanceOf(address(zeroXAdapter)), 0);
        assertEq(tokenB.balanceOf(address(zeroXAdapter)), 0);
        assertEq(tokenC.balanceOf(address(zeroXAdapter)), 0);
        assertEq(tokenA.allowance(address(zeroXAdapter), address(allowanceHolder)), 0);
        assertEq(tokenB.allowance(address(zeroXAdapter), address(allowanceHolder)), 0);
        assertEq(tokenC.allowance(address(zeroXAdapter), address(allowanceHolder)), 0);
    }
}
