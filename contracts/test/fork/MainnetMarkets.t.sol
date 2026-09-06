// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MainnetRehearsalBase } from "./MainnetRehearsalBase.sol";
import { IERC20, IERC20Metadata } from "../../src/interfaces/IERC20.sol";
import { ManagedOTFVault } from "../../src/ManagedOTFVault.sol";
import { VaultCreationParams } from "../../src/VaultTypes.sol";
import { BasketMintRequest, BasketRedeemRequest, SwapLeg } from "../../src/OTFEntryExitRouter.sol";

interface RehearsalV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface RehearsalV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
}

interface RehearsalQuoter {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

contract MainnetMarketsTest is MainnetRehearsalBase {
    IERC20 internal usdg;
    RehearsalQuoter internal quoter;
    address[] internal stocks;
    uint24[] internal fees;
    uint24 internal wethFee;
    ManagedOTFVault internal vault;

    function setUp() public override {
        super.setUp();
        usdg = IERC20(_pinned(rehearsal, ".usdg"));
        assertEq(
            IERC20Metadata(address(usdg)).decimals(), vm.parseJsonUint(rehearsal, ".usdg.decimals")
        );
        quoter = RehearsalQuoter(_pinned(rehearsal, ".quoter"));
        wethFee = _market(".wethMarket", address(weth));
        stocks = new address[](5);
        uint256[] memory units = new uint256[](stocks.length);
        for (uint256 i; i < stocks.length; ++i) {
            string memory path = string.concat(".stocks[", vm.toString(i), "]");
            stocks[i] = _pinned(rehearsal, path);
            assertEq(
                IERC20Metadata(stocks[i]).decimals(),
                vm.parseJsonUint(rehearsal, string.concat(path, ".decimals"))
            );
            fees.push(_market(path, stocks[i]));
            units[i] = 0.01 ether;
        }
        vm.prank(investor);
        vault = ManagedOTFVault(
            factory.createVault(
                VaultCreationParams({
                    name: "Mainnet five-stock rehearsal OTF",
                    symbol: "REAL",
                    fundThesis: "Mainnet market integration test.",
                    expenseBeneficiary: beneficiary,
                    annualCreatorExpenseRatioBps: 1_000,
                    mintFeeBps: 200,
                    redeemFeeBps: 100,
                    constituents: stocks,
                    bootstrapBasketUnitsPerOTF: units
                })
            )
        );
        vm.startPrank(investor);
        weth.deposit{ value: 2 ether }();
        weth.approve(address(router), type(uint256).max);
        vault.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function testFiveRealStocksMultihopRoundTripAtTwoTradeSizes() public {
        _roundTrip(0.001 ether);
        _roundTrip(0.01 ether);
    }

    function testRealStockNativeEntryAndExit() public {
        SwapLeg[] memory entry = _entry(0.01 ether);
        uint256 before = investor.balance;
        vm.prank(investor);
        (uint256 shares,,,) =
            router.mintFromNative{ value: 0.05 ether }(_request(0.05 ether), entry);
        assertEq(before - investor.balance, 0.05 ether);
        assertGt(shares, 0);
        _cleared();
        SwapLeg[] memory exitLegs = _exit(shares, investor);
        before = investor.balance;
        vm.prank(investor);
        (uint256 received,,) =
            router.redeemToNative(_redemption(shares), new uint256[](stocks.length), exitLegs);
        assertGt(received, 0);
        assertEq(investor.balance - before, received);
        _cleared();
    }

    function testRealStockInKindExitWithAdaptersRevoked() public {
        uint256 shares = _mint(0.01 ether);
        uint256[] memory expected = vault.previewRedeem(shares, investor, 0);
        uint256[] memory balances = new uint256[](stocks.length);
        for (uint256 i; i < stocks.length; ++i) {
            balances[i] = IERC20(stocks[i]).balanceOf(investor);
        }
        vm.startPrank(administrator);
        router.setAdapterApproved(address(v3Adapter), false);
        router.setAdapterApproved(address(v4Adapter), false);
        vm.stopPrank();
        vm.startPrank(investor);
        vault.approve(address(router), 0);
        uint256[] memory received = vault.redeemInKind(shares, investor, expected, 0);
        vm.stopPrank();
        assertEq(vault.balanceOf(investor), 0);
        for (uint256 i; i < stocks.length; ++i) {
            assertGt(received[i], 0);
            assertEq(received[i], expected[i]);
            assertEq(IERC20(stocks[i]).balanceOf(investor) - balances[i], expected[i]);
        }
        _cleared();
    }

    function testRealStockFeesRedeemThroughLiveMarketsAndBurnOtf() public {
        _graduate();
        _mint(0.01 ether);
        vm.warp(block.timestamp + 30 days);
        uint256 navFees = vault.checkpointFees();
        assertGt(navFees, 0);
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        assertGt(creatorShares, 0);
        assertGt(buybackShares, 0);
        SwapLeg[] memory legs = _exit(creatorShares + buybackShares, address(collector));
        uint256 before = weth.balanceOf(beneficiary);
        uint256 supply = otf.totalSupply();
        vm.prank(beneficiary);
        (uint256 payout, uint256 buyback, uint256 burned) = collector.settleFeesViaRedemption(
            address(vault), new uint256[](stocks.length), 0, legs, 1, 1, block.timestamp
        );
        assertGt(payout, 0);
        assertGt(buyback, 0);
        assertGt(burned, 0);
        assertEq(weth.balanceOf(beneficiary) - before, payout);
        assertEq(supply - otf.totalSupply(), burned);
        (creatorShares, buybackShares) = collector.feeAccounts(address(vault));
        assertEq(creatorShares + buybackShares, 0);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(weth.balanceOf(address(collector)), 0);
        assertEq(otf.balanceOf(address(collector)), 0);
        _cleared();
    }

    function _market(string memory path, address asset) private view returns (uint24 fee) {
        address pool = _pinned(rehearsal, string.concat(path, ".pool"));
        fee = uint24(vm.parseJsonUint(rehearsal, string.concat(path, ".pool.fee")));
        assertEq(RehearsalV3Factory(v3Factory).getPool(asset, address(usdg), fee), pool);
        assertEq(RehearsalV3Pool(pool).token0(), asset < address(usdg) ? asset : address(usdg));
        assertEq(RehearsalV3Pool(pool).token1(), asset < address(usdg) ? address(usdg) : asset);
        assertEq(RehearsalV3Pool(pool).fee(), fee);
        assertGt(RehearsalV3Pool(pool).liquidity(), 0, "Selected market has no active liquidity");
    }

    function _roundTrip(uint256 perLeg) private {
        uint256 shares = _mint(perLeg);
        SwapLeg[] memory legs = _exit(shares, investor);
        uint256 before = weth.balanceOf(investor);
        vm.prank(investor);
        (uint256 received,,) =
            router.redeemToToken(_redemption(shares), new uint256[](stocks.length), legs);
        assertGt(received, 0);
        assertEq(weth.balanceOf(investor) - before, received);
        assertEq(vault.balanceOf(investor), 0);
        _cleared();
    }

    function _mint(uint256 perLeg) private returns (uint256 shares) {
        SwapLeg[] memory legs = _entry(perLeg);
        uint256 before = weth.balanceOf(investor);
        vm.prank(investor);
        (shares,,) = router.mintFromToken(_request(perLeg * stocks.length), legs);
        assertGt(shares, 0);
        assertEq(vault.balanceOf(investor), shares);
        assertEq(before - weth.balanceOf(investor), perLeg * stocks.length);
        for (uint256 i; i < stocks.length; ++i) {
            assertGt(vault.accountedBalance(stocks[i]), 0);
            assertEq(IERC20(stocks[i]).balanceOf(address(vault)), vault.accountedBalance(stocks[i]));
        }
        _cleared();
    }

    function _entry(uint256 amount) private returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](stocks.length);
        for (uint256 i; i < stocks.length; ++i) {
            bytes memory path =
                abi.encodePacked(address(weth), wethFee, address(usdg), fees[i], stocks[i]);
            legs[i] = SwapLeg(
                address(v3Adapter), address(weth), stocks[i], amount, _minimum(path, amount), path
            );
        }
    }

    function _exit(uint256 shares, address owner) private returns (SwapLeg[] memory legs) {
        uint256[] memory amounts = vault.previewRedeem(shares, owner, 0);
        legs = new SwapLeg[](stocks.length);
        for (uint256 i; i < stocks.length; ++i) {
            bytes memory path =
                abi.encodePacked(stocks[i], fees[i], address(usdg), wethFee, address(weth));
            legs[i] = SwapLeg(
                address(v3Adapter),
                stocks[i],
                address(weth),
                type(uint256).max,
                _minimum(path, amounts[i]),
                path
            );
        }
    }

    function _minimum(bytes memory path, uint256 amount) private returns (uint256 minimum) {
        (uint256 quote,,,) = quoter.quoteExactInput(path, amount);
        minimum = quote * 99 / 100;
        assertGt(minimum, 0, "Live quote rounds to zero");
    }

    function _request(uint256 amount) private view returns (BasketMintRequest memory) {
        return BasketMintRequest(address(weth), address(vault), amount, 1, block.timestamp);
    }

    function _redemption(uint256 shares) private view returns (BasketRedeemRequest memory) {
        return BasketRedeemRequest(address(vault), address(weth), shares, 1, 0, block.timestamp);
    }

    function _cleared() private view {
        _tokenCleared(address(weth));
        _tokenCleared(address(usdg));
        for (uint256 i; i < stocks.length; ++i) {
            _tokenCleared(stocks[i]);
        }
    }

    function _tokenCleared(address token) private view {
        assertEq(IERC20(token).balanceOf(address(router)), 0);
        assertEq(IERC20(token).balanceOf(address(v3Adapter)), 0);
        assertEq(IERC20(token).allowance(address(router), address(v3Adapter)), 0);
        assertEq(IERC20(token).allowance(address(v3Adapter), v3Router), 0);
    }
}
