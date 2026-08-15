// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { IManagedOTFStrategyHistory } from "../src/interfaces/IManagedOTFStrategyHistory.sol";
import { StrategyVersion, TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract StrategyHistoryTest is ProtocolTestBase {
    function testInitialStrategyIsCompletedAtDeploymentAndStartsCooldown() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = _history(vault);
        StrategyVersion memory version = history.getStrategyVersion(0);

        assertEq(history.strategyVersionCount(), 1);
        assertEq(version.proposedAt, START);
        assertEq(version.activatedAt, START);
        assertEq(version.completedAt, START);
        assertEq(version.rationale, "A test portfolio with explicit safety limits.");
        assertEq(vault.lastCompletedStrategyTimestamp(), START);
        assertEq(vault.nextStrategyChangeTime(), START + 14 days);
    }

    function testProposalRequiresRationaleAndSemanticTargetChange() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory equalWeights) = _equalPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();

        vm.expectRevert(ManagedOTFVaultStorage.StrategyRationaleRequired.selector);
        vault.proposeStrategy(assets, _uint256Weights(equalWeights), "");

        vm.expectRevert(ManagedOTFVaultStorage.StrategyTargetsUnchanged.selector);
        vault.proposeStrategy(assets, _uint256Weights(equalWeights), "No actual target change.");

        address[] memory reversedAssets = new address[](2);
        reversedAssets[0] = assets[1];
        reversedAssets[1] = assets[0];
        uint16[] memory reversedWeights = new uint16[](2);
        reversedWeights[0] = equalWeights[1];
        reversedWeights[1] = equalWeights[0];
        vm.expectRevert(ManagedOTFVaultStorage.StrategyTargetsUnchanged.selector);
        vault.proposeStrategy(
            reversedAssets, _uint256Weights(reversedWeights), "Reordering is not a strategy."
        );
    }

    function testStandardRebalanceConsumesStagedRationaleExactlyOnce() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = _history(vault);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();

        vm.expectRevert(ManagedOTFVaultStorage.StrategyRationaleRequired.selector);
        vault.rebalance(assets, _uint256Weights(weights));

        vault.setNextStrategyRationale("Use the standard ERC-7621 selector.");
        vault.rebalance(assets, _uint256Weights(weights));

        assertEq(history.nextStrategyRationale(), "");
        assertEq(history.pendingStrategyRationale(), "Use the standard ERC-7621 selector.");
        assertEq(history.strategyVersionCount(), 1);
    }

    function testCancellationDoesNotCreateStrategyVersion() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = _history(vault);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();

        vault.proposeStrategy(assets, _uint256Weights(weights), "A proposal that is cancelled.");
        vault.cancelPendingStrategy();

        assertEq(history.strategyVersionCount(), 1);
        assertEq(history.pendingStrategyRationale(), "");
        assertFalse(vault.strategyProposalPending());
    }

    function testActivationCreatesVersionAndCompletionUpdatesSameVersion() public {
        ManagedOTFVault vault = _createVault();
        IManagedOTFStrategyHistory history = _history(vault);
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();
        vault.proposeStrategy(
            assets, _uint256Weights(weights), "Increase token A to sixty percent."
        );

        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        StrategyVersion memory active = history.getStrategyVersion(1);
        assertEq(history.strategyVersionCount(), 2);
        assertEq(active.proposedAt, START + 14 days);
        assertEq(active.activatedAt, START + 16 days);
        assertEq(active.completedAt, 0);
        assertEq(active.rationale, "Increase token A to sixty percent.");
        (address[] memory storedAssets, uint16[] memory storedWeights) =
            history.getStrategyTargets(1);
        assertEq(storedAssets[0], address(tokenA));
        assertEq(storedAssets[1], address(tokenB));
        assertEq(storedWeights[0], 6_000);
        assertEq(storedWeights[1], 4_000);

        TradeInstruction[] memory trades =
            _singleTrade(address(tokenB), address(tokenA), 100 * ONE, 100 * ONE);
        vault.executeRebalanceTrades(trades);

        StrategyVersion memory completed = history.getStrategyVersion(1);
        assertEq(completed.completedAt, START + 16 days);
        assertEq(vault.recentRebalanceRecord(0).strategyVersion, 1);
        assertEq(active.rationale, "Increase token A to sixty percent.");
    }

    function testChallengeCanStartImmediatelyAfterActivation() public {
        ManagedOTFVault vault = _createVault();
        (address[] memory assets, uint16[] memory weights) = _sixtyFortyPortfolio();
        vm.warp(START + 14 days);
        _refreshPrices();
        vault.proposeStrategy(assets, _uint256Weights(weights), "Activate a challengeable target.");
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        vault.activatePendingStrategy();

        vm.prank(ALICE);
        vault.flagOutOfBand();

        assertTrue(vault.strategicRebalanceActive());
        assertTrue(vault.challengeActive());
        assertEq(vault.challengeCaller(), ALICE);
        assertEq(vault.challengeStartedAt(), START + 16 days);
    }

    function _history(ManagedOTFVault vault) private pure returns (IManagedOTFStrategyHistory) {
        return IManagedOTFStrategyHistory(address(vault));
    }
}
