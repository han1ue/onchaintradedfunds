// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { IManagedOTFStrategyHistory } from "../src/interfaces/IManagedOTFStrategyHistory.sol";
import { IManagedOTFVaultView } from "../src/interfaces/IManagedOTFVaultView.sol";
import { IERC7621 } from "../src/interfaces/IERC7621.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { InvariantTestBase, TestBase } from "./TestBase.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ProtocolInvariantHandler is TestBase {
    uint256 private constant ONE = 1e18;
    address public constant ALICE = address(0xA11CE);
    address public constant BOB = address(0xB0B);

    ManagedOTFVault public immutable vault;
    MockStockToken public immutable tokenA;
    MockStockToken public immutable tokenB;
    MockPriceFeed public immutable feedA;
    MockPriceFeed public immutable feedB;
    MockTradeAdapter public immutable adapter;
    address public immutable initialHolder;

    uint256 public successfulMints;
    uint256 public successfulRedeems;
    uint256 public successfulTransfers;
    uint256 public successfulAccruals;
    uint256 public successfulRationaleStages;
    uint256 public successfulProposals;
    uint256 public successfulActivations;
    uint256 public successfulProgressTrades;
    uint256 public successfulCompletionCalls;
    uint256 public successfulRebalances;
    uint256 public invalidRebalancesThatSucceeded;
    uint256 public invalidRebalancesRejected;

    uint256 public eligibleMintAttempts;
    uint256 public eligibleRedeemAttempts;
    uint256 public eligibleTransferAttempts;
    uint256 public eligibleAccrualAttempts;
    uint256 public eligibleRationaleAttempts;
    uint256 public eligibleProposalAttempts;
    uint256 public eligibleActivationAttempts;
    uint256 public eligibleProgressTradeAttempts;
    uint256 public eligibleCompletionAttempts;
    uint256 public eligibleInvalidRebalanceAttempts;
    uint256 public eligibleChallengeAttempts;
    uint256 public successfulChallenges;
    uint256 public eligibleChallengeResolutionAttempts;
    uint256 public successfulChallengeResolutions;
    uint256 public staleOracleChecks;
    uint256 public staleOracleUnexpectedSuccesses;
    uint256 public staleOracleRejections;
    uint256 public pausedOracleChecks;
    uint256 public pausedOracleUnexpectedSuccesses;
    uint256 public pausedOracleRejections;
    uint256 public unexpectedReverts;

    constructor(
        ManagedOTFVault vault_,
        MockStockToken tokenA_,
        MockStockToken tokenB_,
        MockPriceFeed feedA_,
        MockPriceFeed feedB_,
        MockTradeAdapter adapter_,
        address initialHolder_
    ) {
        vault = vault_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        feedA = feedA_;
        feedB = feedB_;
        adapter = adapter_;
        initialHolder = initialHolder_;
    }

    function mintBasket(uint256 actorSeed, uint96 rawShares) external {
        address actor = _actor(actorSeed);
        uint256 shares = bound(rawShares, 1, 5 * ONE);
        uint256[] memory amounts = vault.previewMint(shares);
        if (tokenA.balanceOf(actor) < amounts[0] || tokenB.balanceOf(actor) < amounts[1]) return;

        eligibleMintAttempts++;
        vm.prank(actor);
        try vault.mintWithBasket(shares, actor, amounts) {
            successfulMints++;
        } catch {
            unexpectedReverts++;
        }
    }

    function redeemBasket(uint256 actorSeed, uint96 rawShares) external {
        address actor = _actor(actorSeed);
        uint256 balance = vault.balanceOf(actor);
        if (balance == 0) return;
        uint256 shares = bound(rawShares, 1, balance);
        uint256[] memory minimums = new uint256[](2);

        eligibleRedeemAttempts++;
        vm.prank(actor);
        try vault.redeem(shares, actor, actor, minimums) {
            successfulRedeems++;
        } catch {
            unexpectedReverts++;
        }
    }

    function redeemInitialHolder(uint96 rawShares) external {
        uint256 balance = vault.balanceOf(initialHolder);
        if (balance == 0) return;
        uint256 shares = bound(rawShares, 1, balance);
        uint256[] memory minimums = new uint256[](2);

        eligibleRedeemAttempts++;
        vm.prank(initialHolder);
        try vault.redeem(shares, initialHolder, initialHolder, minimums) {
            successfulRedeems++;
        } catch {
            unexpectedReverts++;
        }
    }

    function transferShares(uint256 actorSeed, uint96 rawAmount) external {
        address sender = _actor(actorSeed);
        address receiver = sender == ALICE ? BOB : ALICE;
        uint256 amount = bound(rawAmount, 0, vault.balanceOf(sender));

        eligibleTransferAttempts++;
        vm.prank(sender);
        try vault.transfer(receiver, amount) {
            successfulTransfers++;
        } catch {
            unexpectedReverts++;
        }
    }

    function advanceAndAccrue(uint32 rawElapsed) external {
        uint256 elapsed = bound(rawElapsed, 1, 30 days);
        vm.warp(block.timestamp + elapsed);
        _refreshOracles();
        eligibleAccrualAttempts++;
        try vault.accrueFees() {
            successfulAccruals++;
        } catch {
            unexpectedReverts++;
        }
    }

    function stageStrategyRationale(uint256 seed) external {
        if (
            vault.challengeActive() || vault.strategicRebalanceActive()
                || vault.strategyProposalPending()
        ) return;
        string memory text = seed % 2 == 0
            ? "The mandate remains unchanged after invariant action A."
            : "The mandate remains unchanged after invariant action B.";
        eligibleRationaleAttempts++;
        try vault.setNextStrategyRationale(text) {
            successfulRationaleStages++;
        } catch {
            unexpectedReverts++;
        }
    }

    function proposeStrategy() external {
        if (
            vault.challengeActive() || vault.strategicRebalanceActive()
                || vault.strategyProposalPending()
        ) return;

        uint256 nextAllowed = vault.nextStrategyChangeTime();
        if (block.timestamp < nextAllowed) vm.warp(nextAllowed);
        _setOraclePrices(100_00000000, 100_00000000);
        if (!vault.isWithinTargetBands()) return;

        uint16 targetA = vault.targetWeightBps(address(tokenA)) == 5_000 ? 6_000 : 5_000;
        (address[] memory assets, uint16[] memory weights,) = _rebalanceInputs(targetA, false);
        eligibleProposalAttempts++;
        try vault.proposeStrategy(
            assets, _uint256Weights(weights), "Invariant-managed strategy target update."
        ) {
            successfulProposals++;
        } catch {
            unexpectedReverts++;
        }
    }

    function activateStrategy() external {
        if (!vault.strategyProposalPending() || vault.challengeActive()) return;
        uint256 activationTime = vault.pendingStrategyActivationTime();
        if (block.timestamp < activationTime) vm.warp(activationTime);
        _setOraclePrices(100_00000000, 100_00000000);
        if (!vault.isWithinTargetBands()) return;

        eligibleActivationAttempts++;
        try vault.activatePendingStrategy() {
            successfulActivations++;
        } catch {
            unexpectedReverts++;
        }
    }

    function executeProgressTrade(uint8 rawDivisor) external {
        if (!vault.strategicRebalanceActive()) return;
        _setOraclePrices(100_00000000, 100_00000000);
        uint16 targetA = vault.targetWeightBps(address(tokenA));
        (,, TradeInstruction[] memory trades) = _rebalanceInputs(targetA, false);
        if (trades.length == 0) return;

        uint256 divisor = bound(rawDivisor, 1, 4);
        if (divisor > 1 && trades[0].amountIn > 1) {
            trades[0].amountIn /= divisor;
            trades[0].minAmountOut = trades[0].amountIn;
        }
        uint256 rebalanceCountBefore = vault.rebalanceCount();
        eligibleProgressTradeAttempts++;
        try vault.executeRebalanceTrades(trades) {
            successfulProgressTrades++;
            _recordCompletion(rebalanceCountBefore);
        } catch {
            unexpectedReverts++;
        }
    }

    function completeStrategy() external {
        if (!vault.strategicRebalanceActive()) return;
        _refreshOracles();
        if (!vault.isWithinTargetBands()) return;

        uint256 rebalanceCountBefore = vault.rebalanceCount();
        eligibleCompletionAttempts++;
        try vault.completeStrategicRebalance() {
            successfulCompletionCalls++;
            _recordCompletion(rebalanceCountBefore);
        } catch {
            unexpectedReverts++;
        }
    }

    function moveOracleIntoTargetBands() external {
        if (!vault.strategicRebalanceActive() || vault.challengeActive()) return;
        uint256 balanceA = tokenA.balanceOf(address(vault));
        uint256 balanceB = tokenB.balanceOf(address(vault));
        uint256 targetA = vault.targetWeightBps(address(tokenA));
        if (balanceA == 0 || balanceB == 0 || targetA == 0 || targetA == 10_000) return;

        uint256 targetPriceA = targetA * balanceB * 100_00000000 / ((10_000 - targetA) * balanceA);
        if (targetPriceA == 0 || targetPriceA > uint256(type(int256).max)) return;
        _setOraclePrices(int256(targetPriceA), 100_00000000);
    }

    function attemptInvalidRebalance() external {
        if (!vault.strategicRebalanceActive()) return;
        _setOraclePrices(100_00000000, 100_00000000);
        uint16 targetA = vault.targetWeightBps(address(tokenA));
        (,, TradeInstruction[] memory progressTrades) = _rebalanceInputs(targetA, false);
        if (progressTrades.length == 0) return;

        address wrongTokenIn = progressTrades[0].tokenOut;
        address wrongTokenOut = progressTrades[0].tokenIn;
        uint256 available = wrongTokenIn == address(tokenA)
            ? tokenA.balanceOf(address(vault))
            : tokenB.balanceOf(address(vault));
        if (available == 0) return;
        uint256 amount = available < ONE ? available : ONE;
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: wrongTokenIn,
            tokenOut: wrongTokenOut,
            amountIn: amount,
            minAmountOut: amount,
            adapterData: ""
        });
        eligibleInvalidRebalanceAttempts++;
        try vault.executeRebalanceTrades(trades) {
            invalidRebalancesThatSucceeded++;
        } catch {
            invalidRebalancesRejected++;
        }
    }

    function startChallenge() external {
        if (vault.challengeActive()) return;
        _setOraclePrices(100_00000000, 100_00000000);
        uint256 currentA = vault.currentWeight(address(tokenA));
        uint256 targetA = vault.targetWeightBps(address(tokenA));
        int256 adversarialPriceA = currentA >= targetA ? int256(200_00000000) : int256(25_00000000);
        _setOraclePrices(adversarialPriceA, 100_00000000);
        if (vault.isWithinChallengeBands()) {
            unexpectedReverts++;
            return;
        }

        eligibleChallengeAttempts++;
        vm.prank(ALICE);
        try vault.flagOutOfBand() {
            successfulChallenges++;
        } catch {
            unexpectedReverts++;
        }
    }

    function restoreOracleAndResolveChallenge() external {
        _setOraclePrices(100_00000000, 100_00000000);
        if (!vault.challengeActive() || !vault.isWithinTargetBands()) return;

        uint256 rebalanceCountBefore = vault.rebalanceCount();
        eligibleChallengeResolutionAttempts++;
        try vault.resolveOutOfBandChallenge() {
            successfulChallengeResolutions++;
            _recordCompletion(rebalanceCountBefore);
        } catch {
            unexpectedReverts++;
        }
    }

    function exerciseStaleOracleFailure() external {
        _setOraclePrices(100_00000000, 100_00000000);
        vm.warp(block.timestamp + 26 hours);
        staleOracleChecks++;
        try vault.totalAssetsValue() {
            staleOracleUnexpectedSuccesses++;
        } catch {
            staleOracleRejections++;
        }
        _refreshOracles();
    }

    function exercisePausedOracleFailure() external {
        _setOraclePrices(100_00000000, 100_00000000);
        tokenA.setOraclePaused(true);
        pausedOracleChecks++;
        try vault.totalAssetsValue() {
            pausedOracleUnexpectedSuccesses++;
        } catch {
            pausedOracleRejections++;
        }
        tokenA.setOraclePaused(false);
        _refreshOracles();
    }

    function _uint256Weights(uint16[] memory weights)
        private
        pure
        returns (uint256[] memory converted)
    {
        converted = new uint256[](weights.length);
        for (uint256 i = 0; i < weights.length; i++) {
            converted[i] = weights[i];
        }
    }

    function _rebalanceInputs(uint16 targetA, bool incomplete)
        private
        view
        returns (address[] memory assets, uint16[] memory weights, TradeInstruction[] memory trades)
    {
        assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        weights = new uint16[](2);
        weights[0] = targetA;
        weights[1] = uint16(10_000 - targetA);

        uint256 balanceA = tokenA.balanceOf(address(vault));
        uint256 balanceB = tokenB.balanceOf(address(vault));
        uint256 desiredA = (balanceA + balanceB) * targetA / 10_000;
        if (desiredA == balanceA) return (assets, weights, new TradeInstruction[](0));

        address tokenIn;
        address tokenOut;
        uint256 amount;
        if (desiredA > balanceA) {
            tokenIn = address(tokenB);
            tokenOut = address(tokenA);
            amount = desiredA - balanceA;
        } else {
            tokenIn = address(tokenA);
            tokenOut = address(tokenB);
            amount = balanceA - desiredA;
        }
        if (incomplete && amount > 1) amount /= 2;

        trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amount,
            minAmountOut: amount,
            adapterData: ""
        });
    }

    function _actor(uint256 seed) private pure returns (address) {
        return seed % 2 == 0 ? ALICE : BOB;
    }

    function _recordCompletion(uint256 rebalanceCountBefore) private {
        if (vault.rebalanceCount() > rebalanceCountBefore) successfulRebalances++;
    }

    function _setOraclePrices(int256 answerA, int256 answerB) private {
        uint80 nextRoundA = feedA.roundId() + 1;
        uint80 nextRoundB = feedB.roundId() + 1;
        feedA.setRoundData(nextRoundA, answerA, block.timestamp, block.timestamp, nextRoundA);
        feedB.setRoundData(nextRoundB, answerB, block.timestamp, block.timestamp, nextRoundB);
    }

    function _refreshOracles() private {
        uint80 nextRoundA = feedA.roundId() + 1;
        uint80 nextRoundB = feedB.roundId() + 1;
        feedA.setRoundData(nextRoundA, feedA.answer(), block.timestamp, block.timestamp, nextRoundA);
        feedB.setRoundData(nextRoundB, feedB.answer(), block.timestamp, block.timestamp, nextRoundB);
    }
}

contract ProtocolInvariantTest is ProtocolTestBase, InvariantTestBase {
    ManagedOTFVault private vault;
    ProtocolInvariantHandler private handler;

    function setUp() public override {
        super.setUp();
        vault = _createVault();

        tokenA.mint(ALICE, 100_000 * ONE);
        tokenB.mint(ALICE, 100_000 * ONE);
        tokenA.mint(BOB, 100_000 * ONE);
        tokenB.mint(BOB, 100_000 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(BOB);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        handler = new ProtocolInvariantHandler(
            vault, tokenA, tokenB, feedA, feedB, adapter, address(this)
        );
        vault.transferOwnership(address(handler));

        bytes4[] memory selectors = new bytes4[](16);
        selectors[0] = handler.mintBasket.selector;
        selectors[1] = handler.redeemBasket.selector;
        selectors[2] = handler.transferShares.selector;
        selectors[3] = handler.advanceAndAccrue.selector;
        selectors[4] = handler.stageStrategyRationale.selector;
        selectors[5] = handler.proposeStrategy.selector;
        selectors[6] = handler.activateStrategy.selector;
        selectors[7] = handler.executeProgressTrade.selector;
        selectors[8] = handler.completeStrategy.selector;
        selectors[9] = handler.attemptInvalidRebalance.selector;
        selectors[10] = handler.startChallenge.selector;
        selectors[11] = handler.restoreOracleAndResolveChallenge.selector;
        selectors[12] = handler.exerciseStaleOracleFailure.selector;
        selectors[13] = handler.exercisePausedOracleFailure.selector;
        selectors[14] = handler.redeemInitialHolder.selector;
        selectors[15] = handler.moveOracleIntoTargetBands.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function testHandlerCriticalTransitionsAreNonVacuous() public {
        handler.startChallenge();
        assertEq(handler.successfulChallenges(), 1);
        assertTrue(vault.challengeActive());
        handler.restoreOracleAndResolveChallenge();
        assertEq(handler.successfulChallengeResolutions(), 1);
        assertFalse(vault.challengeActive());

        handler.stageStrategyRationale(0);
        handler.proposeStrategy();
        assertEq(handler.successfulProposals(), 1);
        assertTrue(vault.strategyProposalPending());
        handler.activateStrategy();
        assertEq(handler.successfulActivations(), 1);
        assertTrue(vault.strategicRebalanceActive());
        handler.attemptInvalidRebalance();
        assertEq(handler.invalidRebalancesRejected(), 1);
        handler.executeProgressTrade(0);
        assertEq(handler.successfulProgressTrades(), 1);
        assertEq(handler.successfulRebalances(), 1);
        assertFalse(vault.strategicRebalanceActive());

        handler.proposeStrategy();
        handler.activateStrategy();
        assertEq(handler.successfulActivations(), 2);
        uint256 balanceA = tokenA.balanceOf(address(vault));
        uint256 balanceB = tokenB.balanceOf(address(vault));
        assertGt(balanceA, balanceB);
        tokenB.mint(address(vault), balanceA - balanceB);
        handler.completeStrategy();
        assertEq(handler.successfulCompletionCalls(), 1);
        assertEq(handler.successfulRebalances(), 2);

        handler.exerciseStaleOracleFailure();
        handler.exercisePausedOracleFailure();
        assertEq(handler.staleOracleRejections(), 1);
        assertEq(handler.pausedOracleRejections(), 1);

        handler.advanceAndAccrue(1);
        handler.mintBasket(0, uint96(ONE));
        handler.transferShares(0, uint96(ONE / 2));
        handler.redeemBasket(1, uint96(ONE / 2));
        handler.redeemInitialHolder(uint96(ONE));
        assertGt(handler.successfulAccruals(), 0);
        assertGt(handler.successfulMints(), 0);
        assertGt(handler.successfulTransfers(), 0);
        assertGt(handler.successfulRedeems(), 0);
        assertEq(handler.unexpectedReverts(), 0);
    }

    function invariantShareSupplyEqualsKnownHolderBalances() public view {
        uint256 accountedSupply = vault.balanceOf(address(this)) + vault.balanceOf(ALICE)
            + vault.balanceOf(BOB) + vault.balanceOf(FEE_RECIPIENT)
            + vault.balanceOf(address(collector)) + vault.balanceOf(address(vault));
        assertEq(vault.totalSupply(), accountedSupply);
    }

    function invariantPortfolioAlwaysSatisfiesMandateLimits() public {
        address[] memory assets = vault.assets();
        uint16[] memory weights = vault.targetWeightsBps();
        uint256 sum;

        assertGt(assets.length, 0);
        assertEq(assets.length, weights.length);
        for (uint256 i; i < assets.length; ++i) {
            assertTrue(assetRegistry.isRegisteredAsset(assets[i]));
            // Raising the protocol floor is intentionally non-retroactive for active targets.
            assertGt(weights[i], 0);
            sum += weights[i];
            for (uint256 j = i + 1; j < assets.length; ++j) {
                assertTrue(assets[i] != assets[j]);
            }
        }
        assertEq(sum, 10_000);
    }

    function invariantVaultAlwaysHasPositiveBackingAndNav() public {
        assertGt(tokenA.balanceOf(address(vault)), 0);
        assertGt(tokenB.balanceOf(address(vault)), 0);
        assertGt(vault.totalAssetsValue(), 0);
        assertGt(vault.navPerShare(), 0);
    }

    function invariantLockedLiquidityCanNeverBeBurned() public view {
        assertGe(vault.balanceOf(address(vault)), vault.MINIMUM_LIQUIDITY_SHARES());
        assertGe(vault.totalSupply(), vault.MINIMUM_LIQUIDITY_SHARES());
    }

    function invariantExecutorNeverRetainsAssetsOrApprovals() public view {
        RebalanceExecutor currentExecutor = RebalanceExecutor(vault.rebalanceExecutor());
        assertEq(tokenA.allowance(address(vault), address(currentExecutor)), 0);
        assertEq(tokenB.allowance(address(vault), address(currentExecutor)), 0);
        assertEq(tokenA.balanceOf(address(currentExecutor)), 0);
        assertEq(tokenB.balanceOf(address(currentExecutor)), 0);
    }

    function invariantCooldownAndHistoryRemainConsistent() public {
        assertLe(vault.lastCompletedStrategyTimestamp(), block.timestamp);
        assertEq(
            vault.nextStrategyChangeTime(),
            uint256(vault.lastCompletedStrategyTimestamp()) + vault.STRATEGY_CHANGE_COOLDOWN()
        );
        assertEq(vault.rebalanceCount(), handler.successfulRebalances());
        uint256 expectedRecent = vault.rebalanceCount() < 16 ? vault.rebalanceCount() : 16;
        assertEq(IManagedOTFVaultView(address(vault)).recentRebalanceCount(), expectedRecent);
        assertEq(handler.invalidRebalancesThatSucceeded(), 0);
        assertEq(handler.unexpectedReverts(), 0);
        assertEq(handler.successfulMints(), handler.eligibleMintAttempts());
        assertEq(handler.successfulRedeems(), handler.eligibleRedeemAttempts());
        assertEq(handler.successfulTransfers(), handler.eligibleTransferAttempts());
        assertEq(handler.successfulAccruals(), handler.eligibleAccrualAttempts());
        assertEq(handler.successfulRationaleStages(), handler.eligibleRationaleAttempts());
        assertEq(handler.successfulProposals(), handler.eligibleProposalAttempts());
        assertEq(handler.successfulActivations(), handler.eligibleActivationAttempts());
        assertEq(handler.successfulProgressTrades(), handler.eligibleProgressTradeAttempts());
        assertEq(handler.successfulCompletionCalls(), handler.eligibleCompletionAttempts());
        assertEq(handler.invalidRebalancesRejected(), handler.eligibleInvalidRebalanceAttempts());
        assertEq(handler.successfulChallenges(), handler.eligibleChallengeAttempts());
        assertEq(
            handler.successfulChallengeResolutions(), handler.eligibleChallengeResolutionAttempts()
        );
        assertEq(handler.staleOracleUnexpectedSuccesses(), 0);
        assertEq(handler.staleOracleRejections(), handler.staleOracleChecks());
        assertEq(handler.pausedOracleUnexpectedSuccesses(), 0);
        assertEq(handler.pausedOracleRejections(), handler.pausedOracleChecks());
    }

    function invariantAdministrativeHistoryIsAppendOnly() public view {
        assertEq(vault.manager(), address(handler));
        uint256 expectedVersions = handler.successfulActivations() + 1;
        assertEq(
            IManagedOTFStrategyHistory(address(vault)).strategyVersionCount(), expectedVersions
        );
        assertEq(
            handler.successfulProposals(),
            handler.successfulActivations() + (vault.strategyProposalPending() ? 1 : 0)
        );
        assertEq(
            handler.successfulActivations(),
            handler.successfulRebalances() + (vault.strategicRebalanceActive() ? 1 : 0)
        );
        assertFalse(vault.strategyProposalPending() && vault.strategicRebalanceActive());
        assertLe(vault.lastFeeAccrualTimestamp(), block.timestamp);
        assertEq(vault.STRATEGY_CHANGE_COOLDOWN(), 14 days);
    }

    function invariantFactoryProvenanceNeverChanges() public view {
        assertTrue(factory.isVault(address(vault)));
        assertEq(factory.creatorOf(address(vault)), address(this));
        assertEq(vault.factory(), address(factory));
    }

    function invariantStandardRedemptionOrderMatchesTrackedAssets() public {
        address[] memory tracked = vault.assets();
        IERC7621 basket = IERC7621(address(vault));
        (address[] memory constituents, uint256[] memory weights) = basket.getConstituents();
        uint256[] memory preview = vault.previewWithdraw(ONE);

        assertLe(tracked.length, 100);
        assertEq(constituents.length, tracked.length);
        assertEq(weights.length, tracked.length);
        assertEq(preview.length, tracked.length);
        assertEq(basket.totalConstituents(), tracked.length);
        uint256 totalWeight;
        for (uint256 i; i < tracked.length; ++i) {
            assertEq(constituents[i], tracked[i]);
            assertTrue(basket.isConstituent(tracked[i]));
            assertEq(basket.getWeight(tracked[i]), weights[i]);
            totalWeight += weights[i];
        }
        if (!vault.sunset()) assertEq(totalWeight, 10_000);
    }
}
