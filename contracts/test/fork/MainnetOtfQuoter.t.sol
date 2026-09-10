// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MainnetRehearsalBase } from "./MainnetRehearsalBase.sol";
import { ManagedOTFVault } from "../../src/ManagedOTFVault.sol";
import { VaultCreationParams } from "../../src/VaultTypes.sol";
import { BasketMintRequest, BasketRedeemRequest, SwapLeg } from "../../src/OTFEntryExitRouter.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract MainnetOtfQuoterTest is MainnetRehearsalBase {
    IV4Quoter internal quoter;
    PoolKey internal key;

    function setUp() public override {
        super.setUp();
        string memory routing = vm.readFile("../scripts/fixtures/robinhood-mainnet-routing.json");
        quoter = IV4Quoter(_pinned(routing, ".dependencies.uniswapV4Quoter"));
        assertEq(address(quoter.poolManager()), poolManager);
        (address currency0, address currency1, uint24 fee, int24 spacing, address hooks) =
            launch.poolKey();
        key = PoolKey(
            Currency.wrap(currency0), Currency.wrap(currency1), fee, spacing, IHooks(hooks)
        );
    }

    function testQuoterRejectsUninitializedCanonicalPool() public {
        IV4Quoter.QuoteExactSingleParams memory params = _params(true, 1 ether);
        vm.expectRevert();
        quoter.quoteExactOutputSingle(params);
    }

    function testQuoterBackedOtfBasketDuringBootstrap() public {
        vm.prank(deployer);
        launch.initializeLaunch();
        _roundTrip();
    }

    function testQuoterBackedOtfBasketAfterGraduation() public {
        _graduate();
        _roundTrip();
    }

    function _roundTrip() private {
        address[] memory assets = new address[](2);
        assets[0] = address(otf);
        assets[1] = address(weth);
        uint256[] memory units = new uint256[](2);
        units[0] = 1 ether;
        units[1] = 0.001 ether;
        vm.prank(investor);
        ManagedOTFVault vault = ManagedOTFVault(
            factory.createVault(
                VaultCreationParams({
                    name: "Canonical basket OTF",
                    symbol: "CANON",
                    fundThesis: "Canonical pool rehearsal.",
                    expenseBeneficiary: beneficiary,
                    annualCreatorExpenseRatioBps: 0,
                    mintFeeBps: 0,
                    redeemFeeBps: 0,
                    constituents: assets,
                    bootstrapBasketUnitsPerOTF: units
                })
            )
        );

        (uint256 quotedWeth, uint256 gasEstimate) =
            quoter.quoteExactOutputSingle(_params(true, units[0]));
        assertGt(quotedWeth, 0);
        assertGt(gasEstimate, 0);
        uint256 paddedWeth = (quotedWeth * 10_050 + 9_999) / 10_000;
        (uint256 bought,) = quoter.quoteExactInputSingle(_params(true, paddedWeth));
        assertGe(bought, units[0]);
        SwapLeg[] memory legs = new SwapLeg[](1);
        legs[0] = _leg(true, paddedWeth, units[0]);
        uint256 budget = paddedWeth + units[1];
        vm.startPrank(investor);
        weth.deposit{ value: budget }();
        weth.approve(address(router), budget);
        (uint256 shares,,) = router.mintFromToken(
            BasketMintRequest(address(weth), address(vault), budget, 1 ether, block.timestamp), legs
        );
        vault.approve(address(router), shares);
        vm.stopPrank();
        assertEq(shares, 1 ether);
        assertEq(vault.accountedBalance(address(otf)), units[0]);

        uint256[] memory amounts = vault.previewRedeem(shares, investor, 0);
        (uint256 quotedSale,) = quoter.quoteExactInputSingle(_params(false, amounts[0]));
        uint256 minimumSale = quotedSale * 9950 / 10_000;
        assertGt(minimumSale, 0);
        legs[0] = _leg(false, amounts[0], minimumSale);
        uint256 beforeSale = weth.balanceOf(investor);
        vm.prank(investor);
        (uint256 received,,) = router.redeemToToken(
            BasketRedeemRequest(
                address(vault), address(weth), shares, amounts[1] + minimumSale, 0, block.timestamp
            ),
            new uint256[](2),
            legs
        );
        assertEq(received, amounts[1] + quotedSale);
        assertEq(weth.balanceOf(investor) - beforeSale, received);
        assertEq(vault.balanceOf(investor), 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(otf.balanceOf(address(router)), 0);
        assertEq(weth.balanceOf(address(universalAdapter)), 0);
        assertEq(otf.balanceOf(address(universalAdapter)), 0);
    }

    function _params(bool buy, uint256 amount)
        private
        view
        returns (IV4Quoter.QuoteExactSingleParams memory)
    {
        return IV4Quoter.QuoteExactSingleParams(
            key,
            buy == (address(weth) == Currency.unwrap(key.currency0)),
            SafeCast.toUint128(amount),
            ""
        );
    }

    function _leg(bool buy, uint256 amount, uint256 minimum) private view returns (SwapLeg memory) {
        address tokenIn = buy ? address(weth) : address(otf);
        address tokenOut = buy ? address(otf) : address(weth);
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey(Currency.wrap(tokenOut), key.fee, key.tickSpacing, key.hooks, "");
        return SwapLeg(
            address(universalAdapter),
            tokenIn,
            tokenOut,
            amount,
            minimum,
            bytes.concat(hex"04", abi.encode(tokenIn, path))
        );
    }
}
