// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../src/interfaces/IERC20.sol";
import { BuybackCollector } from "../src/BuybackCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import {
    OTFEntryExitRouter,
    BasketMintRequest,
    BasketRedeemRequest,
    BasketSwapRequest,
    SwapLeg
} from "../src/OTFEntryExitRouter.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { MockWETH } from "./mocks/MockWETH.sol";
import { MockTradeAdapter } from "./mocks/MockTradeAdapter.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager
} from "./mocks/MockUniswapV4.sol";
import { ShutdownBuybackLaunchSource } from "./BuybackCollectorShutdown.t.sol";
import { InvariantTestBase } from "./TestBase.sol";
import { ActionAccounting } from "./helpers/ActionAccounting.sol";

contract ComposedProtocolHandler is ActionAccounting {
    OTFToken public otf;
    MockWETH public weth;
    MockStockToken public stock;
    MockPermit2 public permit2;
    MockUniswapUniversalRouter public venue;
    MockTradeAdapter public adapter;
    BuybackCollector public collector;
    OTFFactory public factory;
    OTFEntryExitRouter public router;
    ManagedOTFVault[2] public vaults;
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCAFE)];
    address[2] public beneficiaries = [address(0xBEEF), address(0xF00D)];
    uint256[2] public creatorCredits;
    uint256[2] public buybackCredits;
    uint256[2] public unsolicitedShares;
    uint256 public paid;
    uint256 public burned;

    constructor() {
        vm.warp(1_000_000);
        otf = new OTFToken(address(this));
        weth = new MockWETH();
        stock = new MockStockToken("Stock", "S", 18);
        permit2 = new MockPermit2();
        MockUniswapV4PoolManager pool = new MockUniswapV4PoolManager();
        venue = new MockUniswapUniversalRouter(address(pool), address(permit2));
        ShutdownBuybackLaunchSource launch =
            new ShutdownBuybackLaunchSource(address(otf), address(weth), address(pool));
        collector = new BuybackCollector(address(launch), address(venue), address(permit2));
        factory = new OTFFactory(address(new ManagedOTFVault()), address(collector), address(otf));
        collector.configureFactory(address(factory));
        router = new OTFEntryExitRouter(address(factory), address(this), address(weth));
        factory.configureEntryExitRouter(address(router));
        adapter = new MockTradeAdapter(address(router));
        router.setAdapterApproved(address(adapter), true);
        adapter.setRate(address(weth), address(stock), 1, 1);
        adapter.setRate(address(stock), address(weth), 1, 1);
        adapter.setRate(address(otf), address(weth), 1, 1);
        adapter.setRate(address(weth), address(otf), 1, 1);
        adapter.setRate(address(stock), address(otf), 1, 1);
        adapter.setRate(address(otf), address(stock), 1, 1);
        otf.transfer(address(adapter), 700_000_000 ether);
        otf.transfer(address(router), 41);
        stock.mint(address(adapter), 1_000_000_000 ether);
        weth.mint(address(adapter), 1_000_000_000 ether);
        vm.deal(address(weth), 1_000_000_000 ether);
        otf.transfer(address(venue), 100_000_000 ether);
        // Baselines belong to no operation and must survive every route.
        weth.mint(address(router), 17);
        stock.mint(address(router), 19);
        vm.deal(address(router), 23);
        weth.mint(address(collector), 29);
        stock.mint(address(collector), 31);
        otf.transfer(address(collector), 37);
        for (uint256 i; i < 2; i++) {
            address[] memory assets = new address[](2);
            assets[0] = address(weth);
            assets[1] = i == 0 ? address(stock) : address(otf);
            uint256[] memory units = new uint256[](2);
            units[0] = 1 ether;
            units[1] = i == 0 ? 2 ether : 100_000 ether;
            vaults[i] = ManagedOTFVault(
                factory.createVault(
                    VaultCreationParams(
                        "Composed OTF",
                        "COTF",
                        "Fixed basket.",
                        beneficiaries[i],
                        uint16(100 + i * 900),
                        uint16(200 - i * 199),
                        uint16(100 - i * 99),
                        assets,
                        units
                    )
                )
            );
            adapter.setRate(address(vaults[i]), address(weth), 1, 1);
            mint(i, 100 ether, false);
        }
    }

    function selectors() public pure returns (bytes4[] memory s) {
        s = new bytes4[](9);
        s[0] = this.mint.selector;
        s[1] = this.redeem.selector;
        s[2] = this.convert.selector;
        s[3] = this.settle.selector;
        s[4] = this.advance.selector;
        s[5] = this.shutdown.selector;
        s[6] = this.donateShares.selector;
        s[7] = this.rejectSettlement.selector;
        s[8] = this.rejectRepeatedSettlement.selector;
    }

    function _accrue(uint256 i) private {
        (, uint256 c, uint256 b,) = vaults[i].previewExpenseFees();
        creatorCredits[i] += c;
        buybackCredits[i] += b;
    }

    function _charge(uint256 i, uint256 fee, uint256 benefit) private {
        uint256 c = fee * benefit / 10_000;
        creatorCredits[i] += c;
        buybackCredits[i] += fee - c;
    }

    function _leg(address input, address output, uint256 amount)
        private
        view
        returns (SwapLeg memory)
    {
        return SwapLeg(address(adapter), input, output, amount, 1, "");
    }

    function _exit(uint256 i) private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](1);
        legs[0] = _leg(vaults[i].assets()[1], address(weth), type(uint256).max);
    }

    function mint(uint256 seed, uint256 quantity, bool native) public {
        uint256 i = seed % 2;
        ManagedOTFVault v = vaults[i];
        if (v.shutdown()) {
            noOps[msg.sig]++;
            return;
        }
        address actor = actors[(seed >> 8) % 3];
        uint256 requested = bound(quantity, 1 ether, 100 ether);
        uint256[] memory amounts = v.previewMint(requested);
        // An extra WETH budget exercises refunds without increasing the stock-limited mint.
        uint256 input = amounts[0] + amounts[1] + 123;
        SwapLeg[] memory legs = new SwapLeg[](1);
        legs[0] = _leg(address(weth), v.assets()[1], amounts[1]);
        BasketMintRequest memory r =
            BasketMintRequest(address(weth), address(v), input, requested, block.timestamp);
        _accrue(i);
        uint256 benefit = v.feeCreatorShareBps();
        uint256 beforeShares = v.balanceOf(actor);
        uint256 beforeW = weth.balanceOf(actor);
        uint256 beforeE = actor.balance;
        uint256 minted;
        if (native) {
            vm.deal(actor, beforeE + input);
            vm.prank(actor);
            (minted,,,) = router.mintFromNative{ value: input }(r, legs);
        } else {
            weth.mint(actor, input);
            vm.startPrank(actor);
            weth.approve(address(router), input);
            (minted,,) = router.mintFromToken(r, legs);
            vm.stopPrank();
        }
        uint256 gross = (minted * 10_000 + 9_999 - v.mintFeeBps()) / (10_000 - v.mintFeeBps());
        _charge(i, gross - minted, benefit);
        assertEq(v.balanceOf(actor), beforeShares + minted);
        assertGe(minted, requested);
        // Exactly 123 wei is refunded for these 18-decimal baskets, modulo at most 3 wei of share rounding.
        uint256 refund = native ? actor.balance - beforeE : weth.balanceOf(actor) - beforeW;
        assertGe(refund, 120);
        assertLe(refund, 123);
        successes[msg.sig]++;
    }

    function redeem(uint256 seed, bool native) public {
        uint256 i = seed % 2;
        ManagedOTFVault v = vaults[i];
        address actor = actors[(seed >> 8) % 3];
        uint256 balance = v.balanceOf(actor);
        if (balance < 1e12) {
            noOps[msg.sig]++;
            return;
        }
        uint256 amount = bound(seed >> 16, 1e12, balance);
        uint256[] memory out = v.previewRedeem(amount, actor, 0);
        if (out[1] == 0) {
            noOps[msg.sig]++;
            return;
        }
        uint256 total = out[0] + out[1];
        _accrue(i);
        uint256 fee = v.shutdown() ? 0 : (amount * v.redeemFeeBps() + 9_999) / 10_000;
        _charge(i, fee, v.feeCreatorShareBps());
        BasketRedeemRequest memory r =
            BasketRedeemRequest(address(v), address(weth), amount, total, 0, block.timestamp);
        uint256 beforeOut = native ? actor.balance : weth.balanceOf(actor);
        vm.startPrank(actor);
        v.approve(address(router), amount);
        uint256 received;
        if (native) (received,,) = router.redeemToNative(r, out, _exit(i));
        else (received,,) = router.redeemToToken(r, out, _exit(i));
        vm.stopPrank();
        assertEq(received, total);
        assertEq((native ? actor.balance : weth.balanceOf(actor)) - beforeOut, total);
        assertEq(v.balanceOf(actor), balance - amount);
        successes[msg.sig]++;
    }

    function convert(uint256 seed) public {
        uint256 i = seed % 2;
        uint256 j = 1 - i;
        ManagedOTFVault source = vaults[i];
        ManagedOTFVault target = vaults[j];
        address actor = actors[(seed >> 8) % 3];
        uint256 balance = source.balanceOf(actor);
        if (balance < 1 ether || target.shutdown()) {
            noOps[msg.sig]++;
            return;
        }
        uint256 amount = bound(seed >> 16, 1 ether, balance);
        uint256[] memory available = source.previewRedeem(amount, actor, 0);
        (uint256 expected,) = target.previewMaxMint(available);
        if (expected == 0) {
            noOps[msg.sig]++;
            return;
        }
        _accrue(i);
        _accrue(j);
        _charge(
            i,
            source.shutdown() ? 0 : (amount * source.redeemFeeBps() + 9_999) / 10_000,
            source.feeCreatorShareBps()
        );
        uint256 benefit = target.feeCreatorShareBps();
        SwapLeg[] memory conversion = new SwapLeg[](1);
        conversion[0] = _leg(source.assets()[1], target.assets()[1], type(uint256).max);
        uint256 targetBefore = target.balanceOf(actor);
        vm.startPrank(actor);
        source.approve(address(router), amount);
        (uint256 minted,,) = router.swapBasketToBasket(
            BasketSwapRequest(
                address(source), address(target), amount, expected, 0, block.timestamp
            ),
            available,
            conversion
        );
        vm.stopPrank();
        uint256 gross =
            (minted * 10_000 + 9_999 - target.mintFeeBps()) / (10_000 - target.mintFeeBps());
        _charge(j, gross - minted, benefit);
        assertEq(minted, expected);
        assertEq(source.balanceOf(actor), balance - amount);
        assertEq(target.balanceOf(actor), targetBefore + minted);
        successes[msg.sig]++;
    }

    function settle(uint256 seed, bool sale) public {
        uint256 i = seed % 2;
        ManagedOTFVault v = vaults[i];
        (uint256 oldC, uint256 oldB) = collector.feeAccounts(address(v));
        uint256 pending = v.pendingExpenseFeeShares();
        if (oldC + oldB + pending < 1e9) {
            noOps[msg.sig]++;
            return;
        }
        _accrue(i);
        uint256 c = creatorCredits[i];
        uint256 b = buybackCredits[i];
        uint256 totalShares = c + b;
        uint256[] memory amounts = v.previewRedeem(totalShares, address(collector), 0);
        uint256 output = sale ? totalShares : amounts[0] + amounts[1];
        if (output < 10 || (!sale && amounts[1] == 0)) {
            revert("invalid supported settlement fixture");
        }
        uint256 creatorOut = output * c / totalShares;
        uint256 buybackOut = output - creatorOut;
        uint256 beforeW = weth.balanceOf(beneficiaries[i]);
        uint256 beforeSupply = otf.totalSupply();
        SwapLeg[] memory legs = sale ? new SwapLeg[](1) : _exit(i);
        if (sale) legs[0] = _leg(address(v), address(weth), totalShares);
        vm.prank(beneficiaries[i]);
        (uint256 cw, uint256 bw, uint256 burn) = sale
            ? collector.settleFeesViaShareSale(
                address(v), legs, output, buybackOut, block.timestamp
            )
            : collector.settleFeesViaRedemption(
                    address(v), amounts, 0, legs, output, buybackOut, block.timestamp
                );
        assertEq(cw, creatorOut);
        assertEq(bw, buybackOut);
        assertEq(burn, buybackOut);
        assertEq(weth.balanceOf(beneficiaries[i]) - beforeW, cw);
        assertEq(beforeSupply - otf.totalSupply(), burn);
        creatorCredits[i] = 0;
        buybackCredits[i] = 0;
        paid += cw;
        burned += burn;
        successes[msg.sig]++;
    }

    function rejectRepeatedSettlement(uint256 seed) public {
        uint256 i = seed % 2;
        ManagedOTFVault v = vaults[i];
        (uint256 c, uint256 b) = collector.feeAccounts(address(v));
        if (c + b + v.pendingExpenseFeeShares() != 0) {
            noOps[msg.sig]++;
            return;
        }
        bytes32 beforeState = _digest();
        bytes memory repeatedSettlement = abi.encodeCall(
            collector.settleFeesViaRedemption,
            (address(v), new uint256[](2), 0, _exit(i), 1, 1, block.timestamp)
        );
        vm.prank(beneficiaries[i]);
        _rejected(
            address(collector),
            repeatedSettlement,
            abi.encodeWithSelector(BuybackCollector.NothingToSettle.selector, address(v))
        );
        assertEq(_digest(), beforeState);
    }

    function advance(uint256 seed) public {
        vm.warp(block.timestamp + bound(seed, 1, 30 days));
        successes[msg.sig]++;
    }

    function shutdown(uint256 seed) public {
        uint256 i = seed % 2;
        if (vaults[i].shutdown()) {
            noOps[msg.sig]++;
            return;
        }
        _accrue(i);
        vaults[i].activateEmergencyShutdown();
        successes[msg.sig]++;
    }

    function donateShares(uint256 seed) public {
        uint256 i = seed % 2;
        address actor = actors[(seed >> 8) % 3];
        uint256 balance = vaults[i].balanceOf(actor);
        if (balance == 0) {
            noOps[msg.sig]++;
            return;
        }
        uint256 amount = bound(seed >> 16, 1, balance);
        vm.prank(actor);
        vaults[i].transfer(address(collector), amount);
        unsolicitedShares[i] += amount;
        successes[msg.sig]++;
    }

    function _digest() private view returns (bytes32 digest) {
        digest = keccak256(
            abi.encode(
                otf.totalSupply(),
                weth.balanceOf(address(collector)),
                otf.balanceOf(address(collector)),
                weth.balanceOf(address(router)),
                stock.balanceOf(address(router)),
                weth.balanceOf(address(venue)),
                otf.balanceOf(address(venue))
            )
        );
        for (uint256 i; i < 2; i++) {
            ManagedOTFVault v = vaults[i];
            (uint256 c, uint256 b) = collector.feeAccounts(address(v));
            digest = keccak256(
                abi.encode(
                    digest,
                    c,
                    b,
                    v.totalSupply(),
                    v.pendingExpenseFeeShares(),
                    v.lastFeeCheckpointTimestamp(),
                    v.balanceOf(address(collector)),
                    v.accountedBalances(),
                    weth.balanceOf(beneficiaries[i]),
                    weth.balanceOf(address(v)),
                    IERC20(v.assets()[1]).balanceOf(address(v))
                )
            );
        }
    }

    function rejectSettlement(uint256 seed) public {
        uint256 i = seed % 2;
        ManagedOTFVault v = vaults[i];
        (uint256 c, uint256 b) = collector.feeAccounts(address(v));
        (, uint256 pc, uint256 pb,) = v.previewExpenseFees();
        c += pc;
        b += pb;
        if (c + b < 1e9) {
            noOps[msg.sig]++;
            return;
        }
        uint256[] memory amounts = v.previewRedeem(c + b, address(collector), 0);
        uint256 output = amounts[0] + amounts[1];
        uint256 buyback = output - output * c / (c + b);
        if (amounts[1] == 0 || buyback == 0) {
            noOps[msg.sig]++;
            return;
        }
        bytes32 beforeState = _digest();
        venue.setSkipInputPull(true);
        bytes memory failedSettlement = abi.encodeCall(
            collector.settleFeesViaRedemption,
            (address(v), amounts, 0, _exit(i), output, 1, block.timestamp)
        );
        vm.prank(beneficiaries[i]);
        _rejected(
            address(collector),
            failedSettlement,
            abi.encodeWithSelector(
                BuybackCollector.BalanceDeltaMismatch.selector, address(weth), buyback, 0
            )
        );
        venue.setSkipInputPull(false);
        assertEq(_digest(), beforeState);
        assertModel();
    }

    function assertModel() public view {
        assertEq(otf.totalSupply(), 1_000_000_000 ether - burned);
        assertEq(weth.balanceOf(beneficiaries[0]) + weth.balanceOf(beneficiaries[1]), paid);
        assertEq(otf.balanceOf(address(router)), 41);
        assertEq(weth.balanceOf(address(router)), 17);
        assertEq(stock.balanceOf(address(router)), 19);
        assertEq(address(router).balance, 23);
        assertEq(weth.balanceOf(address(collector)), 29);
        assertEq(stock.balanceOf(address(collector)), 31);
        assertEq(otf.balanceOf(address(collector)), 37);
        assertEq(weth.allowance(address(collector), address(permit2)), 0);
        (uint160 permitAmount,,) =
            permit2.allowance(address(collector), address(weth), address(venue));
        assertEq(permitAmount, 0);
        for (uint256 i; i < 2; i++) {
            ManagedOTFVault v = vaults[i];
            (uint256 c, uint256 b) = collector.feeAccounts(address(v));
            assertEq(c, creatorCredits[i]);
            assertEq(b, buybackCredits[i]);
            assertEq(v.balanceOf(address(collector)), c + b + unsolicitedShares[i]);
            assertEq(v.balanceOf(address(router)), 0);
            assertEq(v.allowance(address(collector), address(router)), 0);
            assertEq(weth.allowance(address(router), address(v)), 0);
            assertEq(IERC20(v.assets()[1]).allowance(address(router), address(v)), 0);
            assertEq(weth.balanceOf(address(v)), v.accountedBalance(address(weth)));
            assertEq(IERC20(v.assets()[1]).balanceOf(address(v)), v.accountedBalance(v.assets()[1]));
        }
    }
}

contract ComposedProtocolInvariantTest is InvariantTestBase {
    ComposedProtocolHandler internal handler;

    function setUp() public {
        handler = new ComposedProtocolHandler();
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), handler.selectors()));
    }

    function invariantFeeIsolationAndOperationBalances() public view {
        handler.assertModel();
    }

    function afterInvariant() public {
        handler.report(handler.selectors());
    }

    function testReachableLifecycle() public {
        handler.mint(256, 12 ether, true);
        handler.mint(257, 17 ether, false);
        handler.advance(30 days);
        handler.convert(256);
        handler.redeem(257, true);
        handler.rejectSettlement(0);
        handler.settle(0, true);
        handler.rejectRepeatedSettlement(0);
        handler.settle(1, false);
        handler.rejectRepeatedSettlement(1);
        handler.donateShares(0);
        handler.advance(30 days);
        handler.shutdown(0);
        handler.shutdown(1);
        handler.settle(0, false);
        handler.rejectRepeatedSettlement(0);
        handler.settle(1, true);
        handler.rejectRepeatedSettlement(1);
        handler.assertModel();
        require(
            handler.expectedFailures(handler.rejectRepeatedSettlement.selector) == 4,
            "repeated settlement rejection must execute"
        );
    }
}
