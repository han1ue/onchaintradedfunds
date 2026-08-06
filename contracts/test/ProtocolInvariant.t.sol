// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { IManagedOTFStrategyHistory } from "../src/interfaces/IManagedOTFStrategyHistory.sol";
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
    uint256 public successfulRebalances;
    uint256 public invalidRebalancesThatSucceeded;

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

        vm.prank(actor);
        try vault.mintWithBasket(shares, actor, amounts) {
            successfulMints++;
        } catch { }
    }

    function redeemBasket(uint256 actorSeed, uint96 rawShares) external {
        address actor = _actor(actorSeed);
        uint256 balance = vault.balanceOf(actor);
        if (balance == 0) return;
        uint256 shares = bound(rawShares, 1, balance);
        uint256[] memory minimums = new uint256[](2);

        vm.prank(actor);
        try vault.redeem(shares, actor, actor, minimums) {
            successfulRedeems++;
        } catch { }
    }

    function redeemInitialHolder(uint96 rawShares) external {
        uint256 balance = vault.balanceOf(initialHolder);
        if (balance == 0) return;
        uint256 shares = bound(rawShares, 1, balance);
        uint256[] memory minimums = new uint256[](2);

        vm.prank(initialHolder);
        try vault.redeem(shares, initialHolder, initialHolder, minimums) {
            successfulRedeems++;
        } catch { }
    }

    function transferShares(uint256 actorSeed, uint96 rawAmount) external {
        address sender = _actor(actorSeed);
        address receiver = sender == ALICE ? BOB : ALICE;
        uint256 amount = bound(rawAmount, 0, vault.balanceOf(sender));

        vm.prank(sender);
        try vault.transfer(receiver, amount) {
            successfulTransfers++;
        } catch { }
    }

    function advanceAndAccrue(uint32 rawElapsed) external {
        uint256 elapsed = bound(rawElapsed, 1, 30 days);
        vm.warp(block.timestamp + elapsed);
        _refreshOracles();
        try vault.accrueFees() {
            successfulAccruals++;
        } catch { }
    }

    function stageStrategyRationale(uint256 seed) external {
        string memory text = seed % 2 == 0
            ? "The mandate remains unchanged after invariant action A."
            : "The mandate remains unchanged after invariant action B.";
        try vault.setNextStrategyRationale(text) {
            successfulRationaleStages++;
        } catch { }
    }

    function rebalancePortfolio() external {
        _refreshOracles();
        uint256 rebalanceCountBefore = vault.rebalanceCount();
        uint16 targetA;
        if (vault.strategicRebalanceActive()) {
            targetA = vault.targetWeightBps(address(tokenA));
        } else {
            uint256 nextAllowed = vault.nextStrategyChangeTime();
            if (block.timestamp < nextAllowed) vm.warp(nextAllowed);
            _refreshOracles();
            targetA = successfulRebalances % 2 == 0 ? 6_000 : 5_000;
        }
        (address[] memory assets, uint16[] memory weights, TradeInstruction[] memory trades) =
            _rebalanceInputs(targetA, false);

        if (!vault.strategicRebalanceActive() && !vault.strategyProposalPending()) {
            try vault.proposeStrategy(
                assets, _uint256Weights(weights), "Invariant-managed strategy target update."
            ) { }
            catch {
                return;
            }
        }
        if (vault.strategyProposalPending()) {
            vm.warp(vault.pendingStrategyActivationTime());
            _refreshOracles();
            try vault.activatePendingStrategy() { }
            catch {
                return;
            }
        }
        if (trades.length != 0) {
            try vault.executeRebalanceTrades(trades) { }
            catch {
                return;
            }
        }
        if (vault.strategicRebalanceActive()) {
            try vault.completeStrategicRebalance() { }
            catch {
                return;
            }
        }
        if (vault.rebalanceCount() > rebalanceCountBefore) {
            successfulRebalances++;
        }
    }

    function attemptInvalidRebalance() external {
        _refreshOracles();
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: ONE,
            minAmountOut: ONE,
            adapterData: ""
        });
        try vault.executeRebalanceTrades(trades) {
            invalidRebalancesThatSucceeded++;
        } catch { }
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

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.mintBasket.selector;
        selectors[1] = handler.redeemBasket.selector;
        selectors[2] = handler.transferShares.selector;
        selectors[3] = handler.advanceAndAccrue.selector;
        selectors[4] = handler.stageStrategyRationale.selector;
        selectors[5] = handler.rebalancePortfolio.selector;
        selectors[6] = handler.attemptInvalidRebalance.selector;
        selectors[7] = handler.redeemInitialHolder.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariantShareSupplyEqualsKnownHolderBalances() public view {
        uint256 accountedSupply = vault.balanceOf(address(this)) + vault.balanceOf(ALICE)
            + vault.balanceOf(BOB) + vault.balanceOf(FEE_RECIPIENT)
            + vault.balanceOf(address(collector)) + vault.balanceOf(address(vault));
        assertEq(vault.totalSupply(), accountedSupply);
    }

    function invariantPortfolioAlwaysSatisfiesMandateLimits() public view {
        address[] memory assets = vault.assets();
        uint16[] memory weights = vault.targetWeightsBps();
        uint256 sum;

        assertGt(assets.length, 0);
        assertEq(assets.length, weights.length);
        for (uint256 i; i < assets.length; ++i) {
            assertTrue(assetRegistry.isApprovedAsset(assets[i]));
            // Raising the protocol floor is intentionally non-retroactive for active targets.
            assertGt(weights[i], 0);
            sum += weights[i];
            for (uint256 j = i + 1; j < assets.length; ++j) {
                assertTrue(assets[i] != assets[j]);
            }
        }
        assertEq(sum, 10_000);
    }

    function invariantVaultAlwaysHasPositiveBackingAndNav() public view {
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

    function invariantCooldownAndHistoryRemainConsistent() public view {
        assertLe(vault.lastCompletedStrategyTimestamp(), block.timestamp);
        assertEq(
            vault.nextStrategyChangeTime(),
            uint256(vault.lastCompletedStrategyTimestamp()) + vault.STRATEGY_CHANGE_COOLDOWN()
        );
        assertEq(vault.rebalanceCount(), handler.successfulRebalances());
        uint256 expectedRecent = vault.rebalanceCount() < 16 ? vault.rebalanceCount() : 16;
        assertEq(vault.recentRebalanceCount(), expectedRecent);
        assertEq(handler.invalidRebalancesThatSucceeded(), 0);
    }

    function invariantAdministrativeHistoryIsAppendOnly() public view {
        assertEq(vault.manager(), address(handler));
        uint256 expectedVersions = vault.rebalanceCount() + 1;
        if (vault.strategicRebalanceActive()) expectedVersions++;
        assertEq(
            IManagedOTFStrategyHistory(address(vault)).strategyVersionCount(), expectedVersions
        );
        assertLe(vault.lastFeeAccrualTimestamp(), block.timestamp);
        assertEq(vault.STRATEGY_CHANGE_COOLDOWN(), 14 days);
    }

    function invariantFactoryProvenanceNeverChanges() public view {
        assertTrue(factory.isVault(address(vault)));
        assertEq(factory.creatorOf(address(vault)), address(this));
        assertEq(vault.factory(), address(factory));
    }
}
