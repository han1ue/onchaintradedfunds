// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { FeeGrowthMath } from "../src/libraries/FeeGrowthMath.sol";
import { MathEx } from "../src/libraries/MathEx.sol";
import { TradeInstruction, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ProtocolFuzzTest is ProtocolTestBase {
    function testFuzzRevokedWeightNormalizationPreservesExactAccounting(
        uint16 rawWeightA,
        uint16 rawWeightB
    ) public {
        uint16 weightA = uint16(bound(rawWeightA, 100, 9_800));
        uint16 weightB = uint16(bound(rawWeightB, 100, 9_900 - weightA));
        uint16 weightC = uint16(10_000 - weightA - weightB);
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](3);
        params.initialAssets[0] = address(tokenA);
        params.initialAssets[1] = address(tokenB);
        params.initialAssets[2] = address(tokenC);
        params.initialTargetWeightsBps = new uint16[](3);
        params.initialTargetWeightsBps[0] = weightA;
        params.initialTargetWeightsBps[1] = weightB;
        params.initialTargetWeightsBps[2] = weightC;
        params.initialAmounts = new uint256[](3);
        params.initialAmounts[0] = uint256(weightA) * ONE;
        params.initialAmounts[1] = uint256(weightB) * ONE;
        params.initialAmounts[2] = uint256(weightC) * ONE;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assetRegistry.setAssetApproved(address(tokenA), false);
        uint16[] memory effectiveTargets = vault.targetWeightsBps();
        uint256 activeTotal = uint256(weightB) + weightC;
        uint256 expectedB = uint256(weightB) * 10_000 / activeTotal;
        uint256 expectedC = uint256(weightC) * 10_000 / activeTotal;
        if (expectedB + expectedC != 10_000) expectedB++;

        assertEq(effectiveTargets[0], 0);
        assertEq(effectiveTargets[1], expectedB);
        assertEq(effectiveTargets[2], expectedC);
        assertEq(uint256(effectiveTargets[1]) + effectiveTargets[2], 10_000);
    }

    function testFactoryAcceptsFixedProtocolCooldown() public {
        VaultInitParams memory params = _defaultParams();

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.STRATEGY_CHANGE_COOLDOWN(), 14 days);
        assertEq(vault.nextStrategyChangeTime(), START + 14 days);
    }

    function testFuzzRebalanceSucceedsAtFixedBoundary(uint16 rawTargetWeight) public {
        uint16 targetA = uint16(bound(rawTargetWeight, 2_000, 8_000));
        if (targetA == 5_000) targetA = 5_001;
        VaultInitParams memory params = _defaultParams();
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint16[] memory weights = new uint16[](2);
        weights[0] = targetA;
        weights[1] = uint16(10_000 - targetA);

        TradeInstruction[] memory trades;
        if (targetA > 5_000) {
            uint256 amount = uint256(targetA - 5_000) * ONE / 10;
            trades = _singleTrade(address(tokenB), address(tokenA), amount, amount);
        } else if (targetA < 5_000) {
            uint256 amount = uint256(5_000 - targetA) * ONE / 10;
            trades = _singleTrade(address(tokenA), address(tokenB), amount, amount);
        } else {
            trades = new TradeInstruction[](0);
        }

        uint256 proposalTime = START + 14 days;
        vm.warp(proposalTime);
        feedA.setRoundData(2, 100_00000000, proposalTime, proposalTime, 2);
        feedB.setRoundData(2, 100_00000000, proposalTime, proposalTime, 2);
        _proposeTarget(vault, assets, weights);
        if (trades.length != 0) vault.executeRebalanceTrades(trades);
        if (vault.strategicRebalanceActive()) vault.completeStrategicRebalance();

        assertEq(vault.lastCompletedStrategyTimestamp(), proposalTime + 48 hours);
        assertEq(vault.rebalanceCount(), 1);
        uint16[] memory actual = vault.currentWeightsBps();
        assertApproxEqAbs(actual[0], targetA, 1);
        assertApproxEqAbs(actual[1], 10_000 - targetA, 1);
    }

    function testFuzzBasketMintThenRedeemPreservesAccounting(uint96 rawShares) public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = bound(rawShares, 1, 50 * ONE);
        uint256[] memory amountsIn = vault.previewMint(shares);

        tokenA.mint(ALICE, amountsIn[0]);
        tokenB.mint(ALICE, amountsIn[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, amountsIn);

        uint256[] memory minimums = new uint256[](2);
        uint256[] memory amountsOut = vault.redeem(shares, ALICE, ALICE, minimums);
        vm.stopPrank();

        assertEq(vault.totalSupply(), 100 * ONE);
        assertLe(amountsIn[0] - amountsOut[0], 1);
        assertLe(amountsIn[1] - amountsOut[1], 1);
        assertLe(tokenA.balanceOf(address(vault)) - 500 * ONE, 1);
        assertLe(tokenB.balanceOf(address(vault)) - 500 * ONE, 1);
    }

    function testFuzzLockedLiquiditySurvivesFullCirculatingRedemption(
        uint96 rawInitialSupply,
        uint96 rawInitialAmount
    ) public {
        VaultInitParams memory params = _defaultParams();
        uint256 minimum = factory.MINIMUM_LIQUIDITY_SHARES();
        params.initialShareSupply =
            bound(rawInitialSupply, factory.MINIMUM_INITIAL_SHARE_SUPPLY(), 1_000 * ONE);
        uint256 initialAmount = bound(rawInitialAmount, 1, 1_000 * ONE);
        params.initialAmounts[0] = initialAmount;
        params.initialAmounts[1] = initialAmount;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        uint256[] memory minimums = new uint256[](2);

        vault.redeem(vault.balanceOf(address(this)), ALICE, address(this), minimums);

        assertEq(vault.totalSupply(), minimum);
        assertEq(vault.balanceOf(address(vault)), minimum);
        assertGt(tokenA.balanceOf(address(vault)), 0);
        assertGt(tokenB.balanceOf(address(vault)), 0);
    }

    function testFuzzDonationCannotAwardDonorSharesOrProfitableRounding(
        uint96 rawDonation,
        uint96 rawShares
    ) public {
        ManagedOTFVault vault = _createVault();
        uint256 donation = bound(rawDonation, 1, 1_000 * ONE);
        uint256 shares = bound(rawShares, 1, 50 * ONE);
        tokenA.mint(ATTACKER, donation);
        vm.prank(ATTACKER);
        assertTrue(tokenA.transfer(address(vault), donation));

        uint256[] memory amountsIn = vault.previewMint(shares);
        tokenA.mint(ALICE, amountsIn[0]);
        tokenB.mint(ALICE, amountsIn[1]);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, amountsIn);
        uint256[] memory minimums = new uint256[](2);
        uint256[] memory amountsOut = vault.redeem(shares, ALICE, ALICE, minimums);
        vm.stopPrank();

        assertLe(amountsIn[0] - amountsOut[0], 1);
        assertLe(amountsIn[1] - amountsOut[1], 1);
        assertEq(vault.balanceOf(ATTACKER), 0);
        assertEq(tokenA.balanceOf(ATTACKER), 0);
    }

    function testFuzzRedeemMatchesPreview(uint96 rawShares) public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = bound(rawShares, 1, 99 * ONE);
        uint256[] memory expected = vault.previewRedeem(shares);
        uint256[] memory minimums = new uint256[](2);

        uint256[] memory actual = vault.redeem(shares, ALICE, address(this), minimums);

        assertEq(actual[0], expected[0]);
        assertEq(actual[1], expected[1]);
        assertEq(tokenA.balanceOf(ALICE), expected[0]);
        assertEq(tokenB.balanceOf(ALICE), expected[1]);
    }

    function testFuzzFeeAccrualMatchesCadenceIndependentGrowth(uint16 rawFeeBps, uint32 rawElapsed)
        public
    {
        uint16 feeBps = uint16(bound(rawFeeBps, 0, 1_000));
        uint256 elapsed = bound(rawElapsed, 1, 365 days);
        VaultInitParams memory params = _defaultParams();
        params.creatorFeeBpsPerYear = feeBps;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        vm.warp(START + elapsed);
        feedA.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        feedB.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        uint256 annualGrowthWad =
            feeBps == 0 ? ONE : MathEx.mulDiv(10_000, ONE, 10_000 - uint256(feeBps));
        uint256 exponentWad = MathEx.mulDiv(elapsed, ONE, 365 days);
        uint256 growthWad = elapsed == 365 days
            ? annualGrowthWad
            : uint256(FeeGrowthMath.powWad(int256(annualGrowthWad), int256(exponentWad)));
        uint256 expectedFeeShares = elapsed == 365 days
            ? MathEx.mulDiv(100 * ONE, 10_000, 10_000 - uint256(feeBps)) - 100 * ONE
            : MathEx.mulDiv(100 * ONE, growthWad, ONE) - 100 * ONE;
        uint256 expectedProtocolShares = expectedFeeShares * 1_500 / 10_000;

        uint256 actualFeeShares = vault.accrueFees();

        assertEq(actualFeeShares, expectedFeeShares);
        assertEq(vault.balanceOf(address(collector)), expectedProtocolShares);
        assertEq(vault.balanceOf(FEE_RECIPIENT), expectedFeeShares - expectedProtocolShares);
        assertEq(vault.totalSupply(), 100 * ONE + expectedFeeShares);
        assertEq(vault.lastFeeAccrualTimestamp(), START + elapsed);
    }

    function testFuzzLongDormancyNeverBricksFeeAccrual(uint16 rawFeeBps, uint32 rawElapsedDays)
        public
    {
        uint16 feeBps = uint16(bound(rawFeeBps, 1, 1_000));
        uint256 elapsed = bound(rawElapsedDays, 366 days, 36_500 days);
        VaultInitParams memory params = _defaultParams();
        params.creatorFeeBpsPerYear = feeBps;
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        vm.warp(START + elapsed);
        feedA.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        feedB.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        uint256 accrued = vault.accrueFees();

        assertGt(accrued, 0);
        assertEq(vault.lastFeeAccrualTimestamp(), START + elapsed);
        assertGt(vault.totalSupply(), 100 * ONE);
    }

    function testFuzzOraclePricesProduceExpectedNav(uint64 rawPriceA, uint64 rawPriceB) public {
        ManagedOTFVault vault = _createVault();
        uint256 priceA = bound(rawPriceA, 1, 1_000_000_000_000);
        uint256 priceB = bound(rawPriceB, 1, 1_000_000_000_000);
        feedA.setRoundData(2, int256(priceA), START, START, 2);
        feedB.setRoundData(2, int256(priceB), START, START, 2);

        uint256 expectedNav = 500 * (priceA + priceB) * 1e10;

        assertEq(vault.totalAssetsValue(), expectedNav);
        assertEq(vault.navPerShare(), expectedNav / 100);
    }

    function testFuzzShareTransfersPreserveSupplyAndBalances(address receiver, uint96 rawAmount)
        public
    {
        vm.assume(receiver != address(0));
        vm.assume(receiver != address(this));
        ManagedOTFVault vault = _createVault();
        uint256 initialManagerShares = 100 * ONE - vault.MINIMUM_LIQUIDITY_SHARES();
        uint256 amount = bound(rawAmount, 0, initialManagerShares);

        vault.transfer(receiver, amount);

        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(vault.balanceOf(address(this)), initialManagerShares - amount);
        assertEq(vault.balanceOf(receiver), amount);
    }

    function testFuzzManagerTransferImmediatelyChangesAuthority(address nextManager) public {
        vm.assume(nextManager != address(0));
        vm.assume(nextManager != address(this));
        vm.assume(nextManager != ATTACKER);
        ManagedOTFVault vault = _createVault();

        vault.transferOwnership(nextManager);
        assertEq(vault.manager(), nextManager);

        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.transferOwnership(ATTACKER);

        vm.prank(nextManager);
        vault.transferOwnership(ATTACKER);
        assertEq(vault.manager(), ATTACKER);
    }
}
