// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeGrowthReference } from "./helpers/FeeGrowthReference.sol";

import { MockStockToken } from "./mocks/MockStockToken.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage as Errors } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import {
    BootstrapTestBase,
    MockCoreRouter,
    MockBuybackReceiver,
    SlashableToken
} from "./BootstrapTestBase.sol";
import { InvariantTestBase } from "./TestBase.sol";
import { ActionAccounting } from "./helpers/ActionAccounting.sol";

contract VaultInvariantHandler is ActionAccounting {
    ManagedOTFVault public immutable vault;
    MockCoreRouter public immutable router;
    MockBuybackReceiver public immutable collector;
    address[4] public holders;
    address[] public assets;
    uint256[] public backing;
    uint256[] public deposits;
    uint256[] public donations;
    uint256[] public forfeited;
    uint256[] public withdrawals;
    uint256[] public losses;
    uint256[4] public shares;
    uint256 public supply;
    uint256 public creatorFees;
    uint256 public buybackFees;
    uint256 public splitRemainder;
    uint256 public stoppedAt;
    uint256 public epochSupply;
    uint256 public epochTimestamp;
    uint256 public epochFees;
    uint256 public immutable timeCap;

    constructor(ManagedOTFVault v, MockCoreRouter r, MockBuybackReceiver c) {
        vault = v;
        router = r;
        collector = c;
        epochTimestamp = block.timestamp;
        timeCap = block.timestamp + 10 * 365 days;
        holders = [address(0xA11CE), address(0xB0B), address(0xCAFE), address(c)];
        assets = v.assets();
        backing = new uint256[](assets.length);
        deposits = new uint256[](assets.length);
        donations = new uint256[](assets.length);
        forfeited = new uint256[](assets.length);
        withdrawals = new uint256[](assets.length);
        losses = new uint256[](assets.length);
    }

    function selectors() public pure returns (bytes4[] memory s) {
        s = new bytes4[](10);
        s[0] = this.mint.selector;
        s[1] = this.redeem.selector;
        s[2] = this.transferShares.selector;
        s[3] = this.donate.selector;
        s[4] = this.advanceTime.selector;
        s[5] = this.checkpoint.selector;
        s[6] = this.shutdown.selector;
        s[7] = this.deficit.selector;
        s[8] = this.rejectInvalid.selector;
        s[9] = this.checkPreview.selector;
    }

    function _benefit() private view returns (uint256) {
        // Binary search is independent of production Math.sqrt.
        uint256 capped = backing[0] < 10_000_000 ether ? backing[0] : 10_000_000 ether;
        uint256 n = (capped / 10_000_000) * 1e18;
        uint256 lo;
        uint256 hi = 1e18 + 1;
        while (hi - lo > 1) {
            uint256 mid = (hi + lo) / 2;
            if (mid * mid <= n) lo = mid;
            else hi = mid;
        }
        return 5_000 + 4_000 * lo / 1e18;
    }

    function _pending() private {
        (uint256 fee, uint256 c, uint256 b, uint16 benefit) = vault.previewExpenseFees();
        assertEq(benefit, _benefit());
        if (!vault.shutdown()) {
            uint256 elapsed = block.timestamp - epochTimestamp;
            require(elapsed <= 10 * 365 days, "reference time domain");
            uint256 growth =
                FeeGrowthReference.growth(vault.annualCreatorExpenseRatioBps(), elapsed);
            uint256 target = epochSupply * (growth - 1e18) / 1e18;
            // Quantization tolerance from the arithmetic suite, plus the carried fractional share.
            assertApproxEqAbs(epochFees + fee, target, epochSupply * 128 / 1e18 + 2);
            epochFees += fee;
        }
        uint256 numerator = fee * benefit + splitRemainder;
        assertEq(c, numerator / 10_000);
        assertEq(c + b, fee);
        if (fee != 0) splitRemainder = numerator % 10_000;
        creatorFees += c;
        buybackFees += b;
        shares[3] += fee;
        supply += fee;
    }

    function _resetEpoch() private {
        epochSupply = supply;
        epochTimestamp = block.timestamp;
        epochFees = 0;
    }

    function _fee(uint256 amount, uint256 benefit) private {
        uint256 c = amount * benefit / 10_000;
        creatorFees += c;
        buybackFees += amount - c;
        shares[3] += amount;
        supply += amount;
    }

    function mint(uint256 seed, uint256 actor) public {
        if (vault.shutdown() || !vault.backingIsSound()) {
            noOps[msg.sig]++;
            return;
        }
        uint256 who = actor % 3;
        uint256 amount = bound(seed, 1e16, 100 ether);
        uint256[] memory preview = vault.previewMint(amount);
        _pending();
        uint256 gross =
            (amount * 10_000 + 10_000 - vault.mintFeeBps() - 1) / (10_000 - vault.mintFeeBps());
        uint256 benefit = _benefit();
        uint256[] memory units = vault.bootstrapBasketUnits();
        for (uint256 i; i < assets.length; i++) {
            uint256 q = supply == 0 ? units[i] : backing[i];
            uint256 d = supply == 0 ? 1e18 : supply;
            uint256 expected = (q * gross + d - 1) / d;
            assertEq(preview[i], expected);
            SlashableToken(assets[i]).mint(address(router), expected);
            router.approveAsset(assets[i], address(vault), expected);
            deposits[i] += expected;
            backing[i] += expected;
        }
        router.mint(vault, amount, holders[who], preview);
        shares[who] += amount;
        supply += amount;
        _fee(gross - amount, benefit);
        _resetEpoch();
        successes[msg.sig]++;
    }

    function redeem(uint256 seed, uint256 actor, bool routed, bool skip) public {
        uint256 who = actor % 4;
        uint256 minimum = vault.shutdown() || who == 3 ? 1 : 2;
        if (shares[who] < minimum || (!vault.shutdown() && !vault.backingIsSound())) {
            noOps[msg.sig]++;
            return;
        }
        uint256 amount = seed % 4 == 0 ? shares[who] : bound(seed, minimum, shares[who]);
        uint256 mask = skip ? uint256(1) << (seed % assets.length) : 0;
        if (routed) mask = 0;
        uint256[] memory preview = vault.previewRedeem(amount, holders[who], mask);
        _pending();
        uint256 fee =
            vault.shutdown() || who == 3 ? 0 : (amount * vault.redeemFeeBps() + 9_999) / 10_000;
        uint256 net = amount - fee;
        uint256 benefit = _benefit();
        address recipient = holders[(who + 1) % 3];
        uint256[] memory beforeBalances = new uint256[](assets.length);
        for (uint256 i; i < assets.length; i++) {
            uint256 reduction = backing[i] * net / supply;
            uint256 actual = deposits[i] + donations[i] - withdrawals[i] - losses[i];
            uint256 available = actual < backing[i] ? actual : backing[i];
            uint256 out = mask & (1 << i) != 0 ? 0 : available * net / supply;
            assertEq(preview[i], out);
            backing[i] -= reduction;
            if (mask & (1 << i) != 0) forfeited[i] += reduction;
            withdrawals[i] += out;
            beforeBalances[i] = SlashableToken(assets[i]).balanceOf(recipient);
        }
        if (routed) {
            vm.prank(holders[who]);
            vault.approve(address(router), amount);
            router.redeem(vault, amount, holders[who], recipient, preview);
        } else {
            vm.prank(holders[who]);
            vault.redeemInKind(amount, recipient, preview, mask);
        }
        for (uint256 i; i < assets.length; i++) {
            assertEq(SlashableToken(assets[i]).balanceOf(recipient), beforeBalances[i] + preview[i]);
        }
        supply -= amount;
        shares[who] -= amount;
        _fee(fee, benefit);
        if (!vault.shutdown()) _resetEpoch();
        if (vault.shutdown() && stoppedAt == 0) stoppedAt = block.timestamp;
        successes[msg.sig]++;
    }

    function transferShares(uint256 seed, uint256 actor) public {
        uint256 from = actor % 3;
        uint256 to = (from + 1 + seed % 2) % 3;
        uint256 amount = seed % (shares[from] + 1);
        vm.prank(holders[from]);
        vault.transfer(holders[to], amount);
        shares[from] -= amount;
        shares[to] += amount;
        successes[msg.sig]++;
    }

    function donate(uint256 seed) public {
        uint256 i = seed % assets.length;
        uint256 amount = bound(seed >> 16, 1, 10_000 ether);
        uint256 benefit = vault.feeCreatorShareBps();
        SlashableToken(assets[i]).mint(address(vault), amount);
        donations[i] += amount;
        assertEq(vault.feeCreatorShareBps(), benefit);
        successes[msg.sig]++;
    }

    function advanceTime(uint256 seed) public {
        if (block.timestamp >= timeCap) {
            noOps[msg.sig]++;
            return;
        }
        uint256 dt = bound(seed, 1, 30 days);
        vm.warp(block.timestamp + dt > timeCap ? timeCap : block.timestamp + dt);
        successes[msg.sig]++;
    }

    function checkpoint() public {
        _pending();
        vault.checkpointFees();
        successes[msg.sig]++;
    }

    function shutdown() public {
        if (vault.shutdown()) {
            noOps[msg.sig]++;
            return;
        }
        _pending();
        if (vault.backingIsSound()) vm.prank(vault.creator());
        vault.activateEmergencyShutdown();
        stoppedAt = block.timestamp;
        successes[msg.sig]++;
    }

    function deficit(uint256 seed) public {
        if (vault.shutdown()) {
            noOps[msg.sig]++;
            return;
        }
        uint256 i = seed % assets.length;
        uint256 actual = SlashableToken(assets[i]).balanceOf(address(vault));
        if (actual == 0) {
            noOps[msg.sig]++;
            return;
        }
        uint256 loss = bound(seed >> 16, 1, actual);
        SlashableToken(assets[i]).slash(address(vault), loss);
        losses[i] += loss;
        successes[msg.sig]++;
    }

    function rejectInvalid(uint256 seed) public {
        uint256 beforeSupply = vault.totalSupply();
        uint256 pending = vault.pendingExpenseFeeShares();
        if (vault.shutdown()) {
            _rejected(
                address(router),
                abi.encodeCall(
                    router.mint, (vault, 1e18, holders[0], new uint256[](assets.length))
                ),
                abi.encodeWithSelector(Errors.VaultShutdown.selector)
            );
        } else if (!vault.backingIsSound()) {
            for (uint256 i; i < assets.length; i++) {
                uint256 actual = SlashableToken(assets[i]).balanceOf(address(vault));
                if (actual >= backing[i]) continue;
                _rejected(
                    address(router),
                    abi.encodeCall(
                        router.mint, (vault, 1e18, holders[0], new uint256[](assets.length))
                    ),
                    abi.encodeWithSelector(
                        Errors.BackingDeficient.selector, assets[i], backing[i], actual
                    )
                );
                break;
            }
        } else if (seed % 2 == 0) {
            _rejected(
                address(vault),
                abi.encodeCall(vault.routerMint, (1e18, holders[0], new uint256[](assets.length))),
                abi.encodeWithSelector(Errors.UnauthorizedRouter.selector, address(this))
            );
        } else {
            _rejected(
                address(vault),
                abi.encodeCall(
                    vault.redeemInKind, (0, holders[0], new uint256[](assets.length), 0)
                ),
                abi.encodeWithSelector(Errors.ZeroShares.selector)
            );
        }
        assertEq(vault.totalSupply(), beforeSupply);
        assertEq(vault.pendingExpenseFeeShares(), pending);
    }

    function checkPreview(uint256 seed) public {
        if (vault.shutdown() || !vault.backingIsSound()) {
            noOps[msg.sig]++;
            return;
        }
        uint256[] memory budget = vault.previewMint(bound(seed, 1e16, 100 ether));
        (uint256 maxShares, uint256[] memory cost) = vault.previewMaxMint(budget);
        uint256[] memory next = vault.previewMint(maxShares + 1);
        bool unaffordable;
        for (uint256 i; i < assets.length; i++) {
            assertLe(cost[i], budget[i]);
            if (next[i] > budget[i]) unaffordable = true;
        }
        assertTrue(unaffordable);
        successes[msg.sig]++;
    }

    function assertModel() public view {
        assertEq(vault.totalSupply(), supply);
        for (uint256 h; h < 4; h++) {
            assertEq(vault.balanceOf(holders[h]), shares[h]);
        }
        bool sound = true;
        for (uint256 i; i < assets.length; i++) {
            if (deposits[i] + donations[i] - withdrawals[i] - losses[i] < backing[i]) {
                sound = false;
            }
            assertEq(vault.accountedBalance(assets[i]), backing[i]);
            assertEq(
                SlashableToken(assets[i]).balanceOf(address(vault)),
                deposits[i] + donations[i] - withdrawals[i] - losses[i]
            );
            assertLe(backing[i] + forfeited[i], deposits[i]);
        }
        assertEq(vault.backingIsSound(), sound);
        assertEq(collector.creatorFeeShares(address(vault)), creatorFees);
        assertEq(collector.buybackFeeShares(address(vault)), buybackFees);
        assertEq(vault.feeCreatorShareBps(), _benefit());
        if (stoppedAt != 0) {
            assertTrue(vault.shutdown());
            assertEq(vault.shutdownAt(), stoppedAt);
            assertEq(vault.pendingExpenseFeeShares(), 0);
        } else {
            assertGe(supply, 1e16);
        }
    }

    function unwind() public {
        shutdown();
        for (uint256 h; h < 4; h++) {
            redeem(0, h, false, false);
        }
        assertModel();
        assertEq(supply, 0);
        for (uint256 i; i < assets.length; i++) {
            assertEq(backing[i], 0);
        }
    }
}

contract ProtocolInvariantTest is BootstrapTestBase, InvariantTestBase {
    VaultInvariantHandler internal handler;

    function _configuration() internal pure virtual returns (uint256, uint16, uint16, uint16) {
        return (3, 1_000, 200, 100);
    }

    function setUp() public {
        vm.warp(1_000_000);
        (uint256 count, uint16 annual, uint16 mintFee, uint16 redeemFee) = _configuration();
        address[] memory assets = new address[](count);
        uint256[] memory units = new uint256[](count);
        for (uint256 i; i < count; i++) {
            uint8 decimals = i == 0 ? 18 : (i % 2 == 0 ? 8 : 6);
            assets[i] = address(new SlashableToken("Constituent", "C", decimals));
            units[i] = i == 0 ? 100_000 ether : (i + 3) * 10 ** decimals;
        }
        MockBuybackReceiver collector = new MockBuybackReceiver();
        OTFFactory factory =
            new OTFFactory(address(new ManagedOTFVault()), address(collector), assets[0]);
        collector.configureFactory(address(factory));
        MockCoreRouter router = new MockCoreRouter(address(factory));
        factory.configureEntryExitRouter(address(router));
        VaultCreationParams memory p = _creationParams(assets, units, annual);
        p.mintFeeBps = mintFee;
        p.redeemFeeBps = redeemFee;
        vm.prank(CREATOR);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(p));
        handler = new VaultInvariantHandler(vault, router, collector);
        for (uint256 h; h < 3; h++) {
            handler.mint((h + 1) * 1e18, h);
        }
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), _actionSelectors()));
    }

    function _actionSelectors() internal view virtual returns (bytes4[] memory) {
        return handler.selectors();
    }

    function invariantIndependentLedger() public view {
        handler.assertModel();
    }

    function afterInvariant() public {
        handler.unwind();
        handler.report(handler.selectors());
    }

    function testReachablePendingFeesShutdownAndFinalUnwind() public {
        handler.advanceTime(30 days - 1);
        handler.checkPreview(11 ether);
        handler.redeem(123, 0, true, false);
        handler.transferShares(55, 1);
        handler.donate(42);
        handler.checkpoint();
        handler.redeem(77, 2, false, true);
        handler.deficit(90);
        handler.unwind();
        handler.rejectInvalid(0);
    }
}

contract MinimumBasketInvariantTest is ProtocolInvariantTest {
    function _configuration() internal pure override returns (uint256, uint16, uint16, uint16) {
        return (2, 0, 0, 0);
    }
}

contract MaximumBasketInvariantTest is ProtocolInvariantTest {
    function _configuration() internal pure override returns (uint256, uint16, uint16, uint16) {
        return (20, 1, 1, 1);
    }
}

contract VaultFuzzTest is BootstrapTestBase {
    function testFuzzMintRedeemPreservesBasket(uint256 mintSeed, uint256 redeemSeed) public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory();
        MockStockToken tokenA = new MockStockToken("Asset A", "A", 18);
        MockStockToken tokenB = new MockStockToken("Asset B", "B", 18);
        ManagedOTFVault vault =
            _createTwoAssetVault(factory, address(tokenA), address(tokenB), WAD, WAD, 0);
        uint256 shares = bound(mintSeed, 1e16, 1_000_000 * WAD);
        uint256[] memory amounts = vault.previewMint(shares);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, shares, ALICE, amounts);

        uint256 redeemShares = redeemSeed % 2 == 0 ? shares : bound(redeemSeed, 1, shares - 1);
        vm.prank(ALICE);
        vault.approve(address(router), redeemShares);
        router.redeem(vault, redeemShares, ALICE, ALICE, new uint256[](2));

        assertEq(tokenA.balanceOf(address(vault)), vault.accountedBalance(address(tokenA)));
        assertEq(tokenB.balanceOf(address(vault)), vault.accountedBalance(address(tokenB)));
        assertEq(vault.accountedBalance(address(tokenA)), vault.accountedBalance(address(tokenB)));
    }
}

contract ActiveVaultInvariantTest is ProtocolInvariantTest {
    function _actionSelectors() internal view override returns (bytes4[] memory selected) {
        bytes4[] memory all = handler.selectors();
        selected = new bytes4[](8);
        for (uint256 i; i < 6; i++) {
            selected[i] = all[i];
        }
        selected[6] = all[8];
        selected[7] = all[9];
    }
}
