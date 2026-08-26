// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../src/ERC20Base.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { IManagedOTFStrategyHistory } from "../src/interfaces/IManagedOTFStrategyHistory.sol";
import { StrategyVersion, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract VaultAccountingAndRolesTest is ProtocolTestBase {
    function testInitializationStoresPortfolioAndMintsInitialShares() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = IManagedOTFStrategyHistory(address(vault));

        assertEq(vault.name(), "Test OTF");
        assertEq(vault.symbol(), "TEST");
        assertEq(vault.decimals(), 18);
        assertEq(vault.manager(), address(this));
        assertEq(vault.feeRecipient(), FEE_RECIPIENT);
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(vault.balanceOf(address(this)), 100 * ONE - LOCKED_LIQUIDITY_SHARES);
        assertEq(vault.balanceOf(address(vault)), LOCKED_LIQUIDITY_SHARES);
        assertEq(vault.totalConstituents(), 2);
        (address[] memory constituents,) = vault.getConstituents();
        assertEq(constituents[0], address(tokenA));
        assertEq(constituents[1], address(tokenB));
        assertEq(vault.targetWeightBps(address(tokenA)), 5_000);
        assertEq(vault.targetWeightBps(address(tokenB)), 5_000);
        assertEq(vault.lastCompletedStrategyTimestamp(), START);
        assertEq(vault.lastFeeAccrualTimestamp(), START);
        assertEq(history.strategyVersionCount(), 1);
        StrategyVersion memory initialStrategy = history.getStrategyVersion(0);
        assertEq(initialStrategy.proposedAt, START);
        assertEq(initialStrategy.activatedAt, START);
        assertEq(initialStrategy.completedAt, START);
        assertEq(initialStrategy.author, address(this));
        assertEq(initialStrategy.rationale, "A test portfolio with explicit safety limits.");
        (address[] memory strategyAssets, uint16[] memory strategyWeights) =
            history.getStrategyTargets(0);
        assertEq(strategyAssets[0], address(tokenA));
        assertEq(strategyAssets[1], address(tokenB));
        assertEq(strategyWeights[0], 5_000);
        assertEq(strategyWeights[1], 5_000);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testNavAndCurrentWeightsUseOraclePrices() public {
        ManagedOTFVault vault = _createVault();

        assertEq(vault.totalAssetsValue(), 100_000 * ONE);
        assertEq(vault.navPerShare(), 1_000 * ONE);
        uint16[] memory weights = vault.currentWeightsBps();
        assertEq(weights[0], 5_000);
        assertEq(weights[1], 5_000);

        feedA.setRoundData(2, 200_00000000, block.timestamp, block.timestamp, 2);
        assertEq(vault.totalAssetsValue(), 150_000 * ONE);
        weights = vault.currentWeightsBps();
        assertEq(weights[0], 6_666);
        assertEq(weights[1], 3_333);
    }

    function testMintWithBasketAndRedeemAreProportional() public {
        ManagedOTFVault vault = _createVault();
        uint256 shares = 10 * ONE;
        uint256[] memory quotedIn = vault.previewMint(shares);
        assertEq(quotedIn[0], 50 * ONE);
        assertEq(quotedIn[1], 50 * ONE);

        tokenA.mint(ALICE, 100 * ONE);
        tokenB.mint(ALICE, 100 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, quotedIn);
        vm.stopPrank();

        assertEq(vault.totalSupply(), 110 * ONE);
        assertEq(vault.balanceOf(ALICE), shares);
        assertEq(tokenA.balanceOf(address(vault)), 550 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 550 * ONE);

        uint256[] memory quotedOut = vault.previewRedeem(shares);
        assertEq(quotedOut[0], 50 * ONE);
        assertEq(quotedOut[1], 50 * ONE);

        uint256[] memory minimums = new uint256[](2);
        minimums[0] = quotedOut[0];
        minimums[1] = quotedOut[1];
        vm.prank(ALICE);
        vault.redeem(shares, ALICE, ALICE, minimums);

        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
    }

    function testPreviewMaxMintMatchesPreviewMintAtRoundingBoundaries() public {
        ManagedOTFVault vault = _createVault();
        tokenA.mint(address(vault), 1);

        uint256[] memory limits = vault.previewMint(1);
        (uint256 shares, uint256[] memory amountsIn) = vault.previewMaxMint(limits);
        assertEq(shares, 1);
        assertEq(amountsIn[0], limits[0]);
        assertEq(amountsIn[1], limits[1]);

        limits = vault.previewMint(10 * ONE + 1);
        (shares, amountsIn) = vault.previewMaxMint(limits);
        assertEq(shares, 10 * ONE + 1);
        assertEq(amountsIn[0], limits[0]);
        assertEq(amountsIn[1], limits[1]);
    }

    function testPreviewMaxMintAmountsNeverExceedLimits() public {
        ManagedOTFVault vault = _createVault();
        tokenA.mint(address(vault), 1);
        uint256[] memory limits = new uint256[](2);
        limits[0] = 50 * ONE + 1;
        limits[1] = 49 * ONE;

        (uint256 shares, uint256[] memory amountsIn) = vault.previewMaxMint(limits);

        assertGt(shares, 0);
        assertLe(amountsIn[0], limits[0]);
        assertLe(amountsIn[1], limits[1]);
        uint256[] memory previewed = vault.previewMint(shares);
        assertEq(amountsIn[0], previewed[0]);
        assertEq(amountsIn[1], previewed[1]);
    }

    function testMintMaximumInputProtectsUserAndRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory maximums = vault.previewMint(10 * ONE);
        maximums[0] -= 1;

        tokenA.mint(ALICE, 100 * ONE);
        tokenB.mint(ALICE, 100 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AmountTooHigh.selector);
        vault.mintWithBasket(10 * ONE, ALICE, maximums);
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
    }

    function testRedeemMinimumOutputProtectsUserAndRevertsAtomically() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory minimums = vault.previewRedeem(10 * ONE);
        minimums[0] += 1;

        vm.expectPartialRevert(IERC7621.InsufficientAmount.selector);
        vault.redeem(10 * ONE, address(this), address(this), minimums);

        assertEq(vault.balanceOf(address(this)), 100 * ONE - LOCKED_LIQUIDITY_SHARES);
        assertEq(vault.totalSupply(), 100 * ONE);
        assertEq(tokenA.balanceOf(address(vault)), 500 * ONE);
    }

    function testDelegatedRedeemConsumesAllowance() public {
        ManagedOTFVault vault = _createVault();
        vault.transfer(ALICE, 20 * ONE);

        vm.prank(ALICE);
        vault.approve(BOB, 10 * ONE);
        uint256[] memory minimums = new uint256[](2);
        vm.prank(BOB);
        vault.redeem(10 * ONE, BOB, ALICE, minimums);

        assertEq(vault.balanceOf(ALICE), 10 * ONE);
        assertEq(vault.allowance(ALICE, BOB), 0);
        assertEq(tokenA.balanceOf(BOB), 50 * ONE);
        assertEq(tokenB.balanceOf(BOB), 50 * ONE);
    }

    function testRedeemRemainsAvailableWhenOracleStalesDuringActiveStrategy() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        _proposeTarget(vault, assets, weights);
        vault.transfer(ALICE, 10 * ONE);

        vm.warp(block.timestamp + 26 hours);
        uint256[] memory minimums = vault.previewRedeem(10 * ONE);
        uint256 tokenABefore = tokenA.balanceOf(ALICE);
        uint256 tokenBBefore = tokenB.balanceOf(ALICE);

        vm.prank(ALICE);
        vault.redeem(10 * ONE, ALICE, ALICE, minimums);

        assertTrue(vault.strategicRebalanceActive());
        assertGt(tokenA.balanceOf(ALICE), tokenABefore);
        assertGt(tokenB.balanceOf(ALICE), tokenBBefore);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StaleOraclePrice.selector);
        vault.completeStrategicRebalance();
    }

    function testApproveRequiresZeroResetBeforeNonzeroReplacement() public {
        ManagedOTFVault vault = _createVault();
        vault.transfer(ALICE, 20 * ONE);

        vm.startPrank(ALICE);
        vault.approve(BOB, 10 * ONE);
        vm.expectPartialRevert(ERC20Base.ERC20NonZeroAllowance.selector);
        vault.approve(BOB, 5 * ONE);

        vault.approve(BOB, 0);
        vault.approve(BOB, 5 * ONE);
        vm.stopPrank();

        assertEq(vault.allowance(ALICE, BOB), 5 * ONE);
    }

    function testFeeAccrualMintsExactCreatorAndProtocolShares() public {
        ManagedOTFVault vault = _createVault();
        uint256 elapsed = 365 days;
        vm.warp(START + elapsed);
        _refreshPrices();

        uint256 expectedFeeShares = 100 * ONE * 100 / (10_000 - 100);
        uint256 expectedProtocolShares = expectedFeeShares * 1_500 / 10_000;
        uint256 expectedCreatorShares = expectedFeeShares - expectedProtocolShares;

        uint256 minted = vault.withdrawManagerFees();
        assertEq(minted, expectedFeeShares);
        assertEq(vault.balanceOf(address(collector)), expectedProtocolShares);
        assertEq(vault.balanceOf(FEE_RECIPIENT), expectedCreatorShares);
        assertEq(vault.totalSupply(), 100 * ONE + expectedFeeShares);
        assertEq(vault.lastFeeAccrualTimestamp(), START + elapsed);
    }

    function testFeeAccrualTwiceAtSameTimestampMintsOnlyOnce() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);
        _refreshPrices();

        uint256 first = vault.withdrawManagerFees();
        uint256 supply = vault.totalSupply();
        uint256 second = vault.withdrawManagerFees();

        assertGt(first, 0);
        assertEq(second, 0);
        assertEq(vault.totalSupply(), supply);
    }

    function testFeeAccrualIsCheckpointCadenceIndependentAtMinimumSupply() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = ONE;
        params.creatorFeeBpsPerYear = 1_000;
        ManagedOTFVault fragmentedVault = ManagedOTFVault(factory.createVault(params));
        ManagedOTFVault singleIntervalVault = ManagedOTFVault(factory.createVault(params));

        vm.warp(START + 1);
        uint256 fragmentedFees = fragmentedVault.withdrawManagerFees();
        assertGt(fragmentedFees, 0);
        assertEq(fragmentedVault.lastFeeAccrualTimestamp(), START + 1);

        for (uint256 i = 2; i <= 400; i++) {
            vm.warp(START + i);
            fragmentedFees += fragmentedVault.withdrawManagerFees();
        }

        vm.warp(START + 400);
        uint256 singleIntervalFees = singleIntervalVault.withdrawManagerFees();

        assertGt(singleIntervalFees, 0);
        assertApproxEqAbs(fragmentedFees, singleIntervalFees, 10_000);
        assertApproxEqAbs(fragmentedVault.totalSupply(), singleIntervalVault.totalSupply(), 10_000);
    }

    function testAnnualFeeIsCadenceIndependent() public {
        VaultInitParams memory params = _defaultParams();
        params.creatorFeeBpsPerYear = 1_000;
        ManagedOTFVault dailyVault = ManagedOTFVault(factory.createVault(params));
        ManagedOTFVault annualVault = ManagedOTFVault(factory.createVault(params));

        for (uint256 day = 1; day <= 365; day++) {
            vm.warp(START + day * 1 days);
            _refreshPrices();
            dailyVault.withdrawManagerFees();
        }
        uint256 annualFees = annualVault.withdrawManagerFees();
        uint256 expectedAnnualFees = 100 * ONE * 1_000 / (10_000 - 1_000);

        assertEq(annualFees, expectedAnnualFees);
        // WAD exponentiation differs by less than 5e-16 share per initial share across 365 calls.
        assertApproxEqAbs(dailyVault.totalSupply(), annualVault.totalSupply(), 50_000);
        assertApproxEqAbs(
            dailyVault.balanceOf(address(collector)),
            annualVault.balanceOf(address(collector)),
            10_000
        );
        assertApproxEqAbs(
            dailyVault.balanceOf(FEE_RECIPIENT), annualVault.balanceOf(FEE_RECIPIENT), 50_000
        );
    }

    function testFeeRateChangeCreatesNonRetroactiveBoundaryAtMinimumSupply() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = ONE;
        params.creatorFeeBpsPerYear = 100;
        ManagedOTFVault changingVault = ManagedOTFVault(factory.createVault(params));
        params.creatorFeeBpsPerYear = 1_000;
        ManagedOTFVault controlVault = ManagedOTFVault(factory.createVault(params));

        vm.warp(START + 3_000);
        _refreshPrices();
        changingVault.setManagerFeeBps(1_000);
        assertEq(changingVault.lastFeeAccrualTimestamp(), START + 3_000);

        vm.warp(START + 3_000 + 365 days);
        _refreshPrices();
        changingVault.withdrawManagerFees();
        controlVault.withdrawManagerFees();

        // The first interval accrued at 1%, so it cannot be repriced retroactively at 10%.
        assertLt(changingVault.totalSupply(), controlVault.totalSupply());
    }

    function testLongDormancyAccruesWithoutBrickingVault() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 36_500 days);
        feedA.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        feedB.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);

        uint256 accrued = vault.withdrawManagerFees();

        assertGt(accrued, 0);
        assertEq(vault.lastFeeAccrualTimestamp(), START + 36_500 days);
        assertGt(vault.totalSupply(), 100 * ONE);
    }

    function testOnlyManagerCanStageNextStrategyRationale() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = IManagedOTFStrategyHistory(address(vault));
        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setNextStrategyRationale("Unauthorized rationale");

        vm.warp(START + 1 days);
        vault.setNextStrategyRationale("Authorized rationale");
        assertEq(history.nextStrategyRationale(), "Authorized rationale");
        assertEq(history.strategyVersionCount(), 1);
        assertEq(
            history.getStrategyVersion(0).rationale, "A test portfolio with explicit safety limits."
        );
    }

    function testStrategyRationaleLengthLimitIsEnforced() public {
        ManagedOTFVault vault = _createVault();
        string memory oversized = _stringOfLength(2_049);
        vm.expectPartialRevert(ManagedOTFVaultStorage.StrategyRationaleTooLong.selector);
        vault.setNextStrategyRationale(oversized);
    }

    function testManagerNominationPreservesOldManagerAndCanBeCancelledOrReplaced() public {
        ManagedOTFVault vault = _createVault();
        vault.transferOwnership(ALICE);

        assertEq(vault.owner(), address(this));
        assertEq(vault.manager(), address(this));
        assertEq(vault.pendingManager(), ALICE);
        assertTrue(vault.authorizedExecutor(address(this)));
        vault.setNextStrategyRationale("Old manager remains active.");

        vault.transferOwnership(address(0));
        assertEq(vault.pendingManager(), address(0));
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                ManagedOTFVaultStorage.OwnableUnauthorizedAccount.selector, ALICE
            )
        );
        vault.acceptOwnership();

        vault.transferOwnership(ALICE);
        vault.transferOwnership(BOB);
        assertEq(vault.pendingManager(), BOB);
    }

    function testPendingManagerAcceptanceAccruesFeesAndCleansManagerState() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = IManagedOTFStrategyHistory(address(vault));
        vault.setExecutor(ALICE, true);

        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();
        vault.proposeStrategyWithPricing(
            assets,
            _uint256Weights(weights),
            _pricingConfigsFor(assets),
            "Pending strategy owned by the old manager."
        );
        assertTrue(vault.strategyProposalPending());

        vault.transferOwnership(BOB);
        uint256 supplyBeforeAcceptance = vault.totalSupply();
        vm.warp(block.timestamp + 1 days);

        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ManagedOTFVaultStorage.OwnableUnauthorizedAccount.selector, ATTACKER
            )
        );
        vault.acceptOwnership();
        assertEq(vault.manager(), address(this));
        assertTrue(vault.strategyProposalPending());

        vm.prank(BOB);
        vault.acceptOwnership();

        assertGt(vault.totalSupply(), supplyBeforeAcceptance);
        assertEq(vault.owner(), BOB);
        assertEq(vault.manager(), BOB);
        assertEq(vault.pendingManager(), address(0));
        assertFalse(vault.strategyProposalPending());
        assertEq(history.pendingStrategyRationale(), "");
        assertEq(history.nextStrategyRationale(), "");
        assertFalse(vault.authorizedExecutor(address(this)));
        assertFalse(vault.authorizedExecutor(ALICE));
        assertTrue(vault.authorizedExecutor(BOB));
        assertEq(vault.authorizedExecutors().length, 1);
        assertEq(vault.authorizedExecutors()[0], BOB);

        vm.expectRevert(ManagedOTFVaultStorage.NotManager.selector);
        vault.setNextStrategyRationale("Old manager cannot stage.");
        vm.prank(BOB);
        vault.setNextStrategyRationale("New manager rationale.");
    }

    function testFeeRecipientTransferIsImmediate() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 1 days);
        _refreshPrices();
        uint256 oldRecipientBalance = vault.balanceOf(FEE_RECIPIENT);
        vault.setFeeRecipient(ALICE);

        assertEq(vault.feeRecipient(), ALICE);
        assertGt(vault.balanceOf(FEE_RECIPIENT), oldRecipientBalance);

        vm.warp(START + 2 days);
        _refreshPrices();
        vault.withdrawManagerFees();
        assertGt(vault.balanceOf(ALICE), 0);
    }

    function testERC20RejectsZeroReceiverAndInsufficientAllowance() public {
        ManagedOTFVault vault = _createVault();
        vm.expectPartialRevert(ERC20Base.ERC20InvalidReceiver.selector);
        vault.transfer(address(0), ONE);

        vm.prank(BOB);
        vm.expectPartialRevert(ERC20Base.ERC20InsufficientAllowance.selector);
        vault.transferFrom(address(this), BOB, ONE);
    }

    function testZeroShareAndBadArrayOperationsRevert() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(ManagedOTFVaultStorage.ZeroShares.selector);
        vault.previewMint(0);
        vm.expectRevert(ManagedOTFVaultStorage.ZeroShares.selector);
        vault.previewRedeem(0);
        vm.expectRevert(ManagedOTFVaultStorage.InvalidArrayLength.selector);
        vault.mintWithBasket(ONE, address(this), empty);
        vm.expectRevert(ManagedOTFVaultStorage.InvalidArrayLength.selector);
        vault.redeem(ONE, address(this), address(this), empty);
    }

    function _stringOfLength(uint256 length) private pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            value[i] = bytes1("x");
        }
        return string(value);
    }
}



