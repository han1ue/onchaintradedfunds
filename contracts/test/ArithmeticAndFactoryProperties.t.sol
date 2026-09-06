// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeGrowthReference } from "./helpers/FeeGrowthReference.sol";

import { FeeGrowthMath } from "../src/libraries/FeeGrowthMath.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage as Errors } from "../src/ManagedOTFVaultStorage.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { BootstrapTestBase, MockCoreRouter, MockBuybackReceiver } from "./BootstrapTestBase.sol";

contract ArithmeticAndFactoryPropertiesTest is BootstrapTestBase {
    // 36-decimal Taylor reference: -log(1-r) = sum(r^k/k), then exp(x).
    // r <= .1 and t <= 10 years: discarded log tail < 2e-62 (60 terms).
    // Reference truncation is far below one WAD wei. The 128-wei tolerance covers
    // production 18-decimal log/time quantization amplified by t and exp(x) < 3.
    function referenceGrowth(uint16 rate, uint256 elapsed) public pure returns (uint256) {
        return FeeGrowthReference.growth(rate, elapsed);
    }

    function testFuzzFeeGrowthIndependentReference(uint16 rateSeed, uint32 elapsedSeed)
        public
        pure
    {
        uint16 rate = rateSeed % 1_001;
        uint256 elapsed = uint256(elapsedSeed) % (10 * 365 days + 1);
        uint256 actual = FeeGrowthMath.expenseDilutionGrowthWad(rate, elapsed);
        assertApproxEqAbs(actual, referenceGrowth(rate, elapsed), 128);
        assertGe(actual, 1e18);
        assertGe(FeeGrowthMath.expenseDilutionGrowthWad(rate, elapsed + 1), actual);
        if (rate < 1_000) {
            assertGe(FeeGrowthMath.expenseDilutionGrowthWad(rate + 1, elapsed), actual);
        }
    }

    function productionGrowth(uint16 rate, uint256 elapsed) external pure returns (uint256) {
        return FeeGrowthMath.expenseDilutionGrowthWad(rate, elapsed);
    }

    function testFuzzCenturyGrowthReference(uint16 rateSeed, uint32 timeSeed) public pure {
        uint16 rate = rateSeed % 1_001;
        uint256 elapsed = uint256(timeSeed) % (100 * 365 days + 1);
        uint256 expected = referenceGrowth(rate, elapsed);
        // Over a century, log quantization compounds. 1e-15 relative error covers
        // 100 years times a few WAD wei of logarithm error, with margin for exp rounding.
        assertApproxEqAbs(
            FeeGrowthMath.expenseDilutionGrowthWad(rate, elapsed), expected, expected / 1e15 + 128
        );
    }

    function testFuzzZeroRateWholeTimestampDomain(uint64 elapsed) public pure {
        assertEq(FeeGrowthMath.expenseDilutionGrowthWad(0, elapsed), 1e18);
    }

    function testFuzzUnrepresentableFeeHorizon(uint16 rateSeed) public {
        vm.expectRevert(FeeGrowthMath.ExpOverflow.selector);
        this.productionGrowth(uint16(1 + rateSeed % 1_000), type(uint64).max);
    }

    function testFeeGrowthTimeAndRateEdges() public pure {
        uint16[3] memory rates = [uint16(0), 1, 1_000];
        uint256[7] memory times =
            [uint256(0), 1, 365 days - 1, 365 days, 365 days + 1, 10 * 365 days, 100 * 365 days];
        for (uint256 r; r < rates.length; r++) {
            for (uint256 t; t < times.length; t++) {
                assertApproxEqAbs(
                    FeeGrowthMath.expenseDilutionGrowthWad(rates[r], times[t]),
                    referenceGrowth(rates[r], times[t]),
                    times[t] > 10 * 365 days
                        ? referenceGrowth(rates[r], times[t]) / 1e15 + 128
                        : 128
                );
            }
        }
    }

    function _params(uint256 seed, uint256 count, address otf)
        private
        returns (VaultCreationParams memory p)
    {
        address[] memory assets = new address[](count);
        uint256[] memory units = new uint256[](count);
        for (uint256 i; i < count; i++) {
            uint8 decimals = i % 2 == 0 ? 18 : 6;
            assets[i] = i == 0 ? otf : address(new MockStockToken("Stock", "S", decimals));
            units[i] = (1 + (seed >> (i * 8)) % 97) * 10 ** decimals + i;
        }
        p = _creationParams(assets, units, uint16(seed % 1_001));
        p.mintFeeBps = uint16((seed >> 16) % 201);
        p.redeemFeeBps = uint16((seed >> 32) % 101);
    }

    function testFuzzFactoryCloneAndMaxMint(uint256 seed, uint256 budgetSeed) public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory();
        VaultCreationParams memory p = _params(seed, 2 + seed % 19, factory.otfToken());
        vm.prank(CREATOR);
        ManagedOTFVault v = ManagedOTFVault(factory.createVault(p));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(v));
        assertTrue(factory.isVault(address(v)));
        assertEq(
            keccak256(address(v).code),
            keccak256(
                abi.encodePacked(
                    hex"363d3d373d3d3d363d73",
                    factory.vaultImplementation(),
                    hex"5af43d82803e903d91602b57fd5bf3"
                )
            )
        );
        assertEq(v.creator(), CREATOR);
        assertEq(v.factory(), address(factory));
        assertEq(v.expenseBeneficiary(), p.expenseBeneficiary);
        assertEq(v.entryExitRouter(), address(router));
        assertEq(v.buybackCollector(), factory.buybackCollector());
        assertEq(v.otfToken(), factory.otfToken());
        assertEq(v.name(), p.name);
        assertEq(v.symbol(), p.symbol);
        assertEq(v.fundThesis(), p.fundThesis);
        assertEq(v.annualCreatorExpenseRatioBps(), p.annualCreatorExpenseRatioBps);
        assertEq(v.mintFeeBps(), p.mintFeeBps);
        assertEq(v.redeemFeeBps(), p.redeemFeeBps);
        address[] memory configured = v.assets();
        for (uint256 i; i < configured.length; i++) {
            assertEq(configured[i], p.constituents[i]);
            assertEq(v.bootstrapBasketUnitsPerOTF(configured[i]), p.bootstrapBasketUnitsPerOTF[i]);
        }
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        v.initialize(p, CREATOR);
        uint256[] memory budgets = v.previewMint(bound(budgetSeed, 1e16, 10_000 ether));
        for (uint256 i; i < budgets.length; i++) {
            budgets[i] += (budgetSeed >> (i * 8)) % 13;
        }
        _maxMint(v, router, budgets);
        vm.warp(block.timestamp + seed % 365 days);
        budgets = v.previewMint(bound(budgetSeed, 1, 10_000 ether));
        _maxMint(v, router, budgets);
    }

    function _maxMint(ManagedOTFVault v, MockCoreRouter router, uint256[] memory budgets) private {
        (uint256 shares, uint256[] memory costs) = v.previewMaxMint(budgets);
        uint256[] memory next = v.previewMint(shares + 1);
        bool exceeds;
        address[] memory assets = v.assets();
        uint256[] memory beforeBalances = v.accountedBalances();
        for (uint256 i; i < costs.length; i++) {
            assertLe(costs[i], budgets[i]);
            if (next[i] > budgets[i]) exceeds = true;
            MockStockToken(assets[i]).mint(address(router), costs[i]);
            router.approveAsset(assets[i], address(v), costs[i]);
        }
        assertTrue(exceeds);
        uint256 holderBefore = v.balanceOf(ALICE);
        uint256[] memory used = router.mint(v, shares, ALICE, costs);
        assertEq(v.balanceOf(ALICE), holderBefore + shares);
        for (uint256 i; i < costs.length; i++) {
            assertEq(used[i], costs[i]);
            assertEq(v.accountedBalance(assets[i]), beforeBalances[i] + costs[i]);
        }
    }

    function testFuzzMinimumSupplyTransitionAndUnwind(uint256 seed, uint256 remainderSeed) public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory();
        VaultCreationParams memory p = _params(seed, 2, factory.otfToken());
        p.annualCreatorExpenseRatioBps = 0;
        p.mintFeeBps = 0;
        p.redeemFeeBps = 0;
        ManagedOTFVault v = ManagedOTFVault(factory.createVault(p));
        uint256 amount = bound(seed, 2e16, 1_000 ether);
        uint256 remaining = bound(remainderSeed, 0, 1e16);
        _bootstrap(v, router, p.constituents, amount);
        vm.prank(ALICE);
        v.redeemInKind(amount - remaining, BOB, new uint256[](2), 0);
        assertEq(v.totalSupply(), remaining);
        assertEq(v.shutdown(), remaining < 1e16);
        if (remaining > 0) {
            vm.prank(ALICE);
            v.redeemInKind(remaining, BOB, new uint256[](2), 0);
        }
        assertTrue(v.shutdown());
        assertEq(v.totalSupply(), 0);
        for (uint256 i; i < 2; i++) {
            assertEq(v.accountedBalance(p.constituents[i]), 0);
            assertEq(MockStockToken(p.constituents[i]).balanceOf(address(v)), 0);
        }
        vm.expectRevert(Errors.VaultShutdown.selector);
        router.mint(v, 1e16, ALICE, new uint256[](2));
    }

    function testFuzzRejectedFactoryCreationIsAtomic(uint256 seed, uint8 kind) public {
        (OTFFactory factory,,) = _deployFactory();
        VaultCreationParams memory p = _params(seed, 2, factory.otfToken());
        bytes memory reason;
        uint256 mode = kind % 9;
        if (mode == 0) {
            p.mintFeeBps = 201;
            reason = abi.encodeWithSelector(Errors.MintFeeTooHigh.selector, 201, 200);
        } else if (mode == 1) {
            p.redeemFeeBps = 101;
            reason = abi.encodeWithSelector(Errors.RedeemFeeTooHigh.selector, 101, 100);
        } else if (mode == 2) {
            p.annualCreatorExpenseRatioBps = 1_001;
            reason = abi.encodeWithSelector(Errors.ExpenseRatioTooHigh.selector, 1_001, 1_000);
        } else if (mode == 3) {
            p.constituents[1] = p.constituents[0];
            reason = abi.encodeWithSelector(Errors.DuplicateConstituent.selector, p.constituents[0]);
        } else if (mode == 4) {
            p.bootstrapBasketUnitsPerOTF[1] = 0;
            reason = abi.encodeWithSelector(
                Errors.InvalidBootstrapBasketUnit.selector, p.constituents[1]
            );
        } else if (mode == 5) {
            p.constituents = new address[](1);
            reason = abi.encodeWithSelector(Errors.InvalidArrayLength.selector, 2, 1);
        } else if (mode == 6) {
            p.constituents = new address[](21);
            reason = abi.encodeWithSelector(Errors.InvalidArrayLength.selector, 20, 21);
        } else if (mode == 7) {
            p.constituents[1] = address(0);
            reason = abi.encodeWithSelector(Errors.InvalidConstituent.selector, address(0));
        } else {
            p.bootstrapBasketUnitsPerOTF = new uint256[](1);
            reason = abi.encodeWithSelector(Errors.InvalidArrayLength.selector, 2, 1);
        }
        uint64 nonce = vm.getNonce(address(factory));
        address predicted = vm.computeCreateAddress(address(factory), nonce);
        vm.expectRevert(reason);
        factory.createVault(p);
        assertEq(factory.vaultCount(), 0);
        assertFalse(factory.isVault(predicted));
        assertEq(vm.getNonce(address(factory)), nonce);
        assertEq(predicted.code.length, 0);
        // A failed initializer must also release the creation guard.
        p = _params(seed, 2, factory.otfToken());
        factory.createVault(p);
        assertEq(factory.vaultCount(), 1);
    }

    function testFuzzCheckpointCadenceIdenticalEconomicSchedule(uint256 seed) public {
        (OTFFactory factory, address collector, MockCoreRouter router) = _deployFactory();
        VaultCreationParams memory p = _params(seed, 2, factory.otfToken());
        p.annualCreatorExpenseRatioBps = uint16(1 + seed % 1_000);
        ManagedOTFVault a = ManagedOTFVault(factory.createVault(p));
        ManagedOTFVault b = ManagedOTFVault(factory.createVault(p));
        _bootstrap(a, router, p.constituents, 10 ether);
        _bootstrap(b, router, p.constituents, 10 ether);
        for (uint256 epoch; epoch < 6; epoch++) {
            uint256 start = block.timestamp;
            uint256 dt = 3 + (seed >> (epoch * 16)) % 90 days;
            vm.warp(start + dt / 3);
            a.checkpointFees();
            vm.warp(start + dt * 2 / 3);
            a.checkpointFees();
            vm.warp(start + dt);
            a.checkpointFees();
            b.checkpointFees();
            assertEq(a.totalSupply(), b.totalSupply());
            assertEq(
                MockBuybackReceiver(collector).creatorFeeShares(address(a)),
                MockBuybackReceiver(collector).creatorFeeShares(address(b))
            );
            assertEq(
                MockBuybackReceiver(collector).buybackFeeShares(address(a)),
                MockBuybackReceiver(collector).buybackFeeShares(address(b))
            );
            assertEq(a.feeShareRemainderWad(), b.feeShareRemainderWad());
            uint256 amount = 1e16 + (seed >> (epoch * 8)) % 1 ether;
            _bootstrap(a, router, p.constituents, amount);
            _bootstrap(b, router, p.constituents, amount);
            vm.prank(ALICE);
            a.redeemInKind(amount / 2, BOB, new uint256[](2), 0);
            vm.prank(ALICE);
            b.redeemInKind(amount / 2, BOB, new uint256[](2), 0);
            assertEq(
                keccak256(abi.encode(a.accountedBalances())),
                keccak256(abi.encode(b.accountedBalances()))
            );
        }
    }
}

