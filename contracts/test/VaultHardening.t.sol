// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { OracleValidationMode } from "../src/interfaces/IOracleRegistry.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { MockFeeOnTransferToken } from "../src/mocks/MockFeeOnTransferToken.sol";
import { MockReentrantToken } from "../src/mocks/MockReentrantToken.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { TradeInstruction, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract VaultHardeningTest is ProtocolTestBase {
    function testLockedLiquidityPreventsZeroSupplyAndVaultCanContinueOperating() public {
        ManagedOTFVault vault = _createVault();
        uint256 circulatingShares = vault.balanceOf(address(this));
        uint256[] memory minimums = new uint256[](2);

        vault.redeem(circulatingShares, ALICE, address(this), minimums);

        assertEq(vault.totalSupply(), vault.MINIMUM_LIQUIDITY_SHARES());
        assertEq(vault.balanceOf(address(vault)), vault.MINIMUM_LIQUIDITY_SHARES());
        assertGt(tokenA.balanceOf(address(vault)), 0);
        assertGt(tokenB.balanceOf(address(vault)), 0);

        uint256 shares = ONE;
        uint256[] memory amounts = vault.previewMint(shares);
        assertGt(amounts[0], 0);
        assertGt(amounts[1], 0);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(shares, ALICE, amounts);
        vm.stopPrank();

        assertEq(vault.totalSupply(), vault.MINIMUM_LIQUIDITY_SHARES() + shares);
    }

    function testFactoryRejectsInitialSupplyThatCannotFundLockedLiquidity() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = ONE - 1;

        vm.expectPartialRevert(OTFFactory.InitialShareSupplyTooSmall.selector);
        factory.createVault(params);
    }

    function testFactoryAcceptsOneWholeInitialShare() public {
        VaultInitParams memory params = _defaultParams();
        params.initialShareSupply = ONE;

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(vault.totalSupply(), ONE);
    }

    function testDonationCannotBypassMaximumInputProtection() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory staleMaximums = vault.previewMint(10 * ONE);

        tokenA.mint(ATTACKER, 100 * ONE);
        vm.prank(ATTACKER);
        assertTrue(tokenA.transfer(address(vault), 100 * ONE));

        tokenA.mint(ALICE, 100 * ONE);
        tokenB.mint(ALICE, 100 * ONE);
        vm.startPrank(ALICE);
        tokenA.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AmountTooHigh.selector);
        vault.mintWithBasket(10 * ONE, ALICE, staleMaximums);
        vm.stopPrank();

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.balanceOf(ATTACKER), 0);
        assertEq(tokenA.balanceOf(address(vault)), 600 * ONE);
    }

    function testDonationDoesNotCreateProfitableMintRedeemRounding() public {
        ManagedOTFVault vault = _createVault();
        tokenA.mint(ATTACKER, 100 * ONE);
        vm.prank(ATTACKER);
        assertTrue(tokenA.transfer(address(vault), 100 * ONE));

        uint256 shares = 10 * ONE;
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

    function testPredictedAddressPrefundingCannotBlockCreation() public {
        VaultInitParams memory params = _defaultParams();
        address predicted = factory.predictVaultAddress(address(this), 0, params);
        assertTrue(tokenA.transfer(predicted, ONE));

        address created = factory.createVault(params);

        assertEq(created, predicted);
        assertEq(tokenA.balanceOf(created), 501 * ONE);
        assertEq(tokenB.balanceOf(created), 500 * ONE);
        assertTrue(factory.isVault(created));
    }

    function testConstituentCannotReenterPredictedCloneBeforeInitialization() public {
        MockReentrantToken reentrantToken = new MockReentrantToken("Reentrant Stock", "REENT", 18);
        MockPriceFeed reentrantFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.setAssetApproved(address(reentrantToken), true);
        oracleRegistry.setOracleConfig(
            address(reentrantToken),
            reentrantFeed,
            25 hours,
            OracleValidationMode.StandardChainlink
        );
        reentrantToken.mint(address(this), 10_000 * ONE);
        reentrantToken.approve(address(factory), type(uint256).max);

        VaultInitParams memory params = _defaultParams();
        params.initialAssets[0] = address(reentrantToken);
        address predicted =
            factory.predictVaultAddress(address(this), factory.creatorNonce(address(this)), params);
        uint256[] memory emptyMaximums = new uint256[](0);
        reentrantToken.configureCallback(
            predicted,
            abi.encodeCall(ManagedOTFVault.mintWithBasket, (ONE, ATTACKER, emptyMaximums)),
            true
        );

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(address(vault), predicted);
        assertFalse(reentrantToken.callbackSucceeded());
        assertEq(vault.balanceOf(ATTACKER), 0);
        assertEq(vault.totalSupply(), params.initialShareSupply);
    }

    function testConstituentCannotInitializePredictedCloneDuringSeedTransfer() public {
        MockReentrantToken reentrantToken = new MockReentrantToken("Reentrant Stock", "REENT", 18);
        MockPriceFeed reentrantFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.setAssetApproved(address(reentrantToken), true);
        oracleRegistry.setOracleConfig(
            address(reentrantToken),
            reentrantFeed,
            25 hours,
            OracleValidationMode.StandardChainlink
        );
        reentrantToken.mint(address(this), 10_000 * ONE);
        reentrantToken.approve(address(factory), type(uint256).max);

        VaultInitParams memory params = _defaultParams();
        params.initialAssets[0] = address(reentrantToken);
        address predicted =
            factory.predictVaultAddress(address(this), factory.creatorNonce(address(this)), params);
        reentrantToken.configureCallback(
            predicted,
            abi.encodeCall(
                ManagedOTFVault.initialize,
                (
                    params,
                    address(reentrantToken),
                    address(assetRegistry),
                    address(oracleRegistry),
                    address(executor),
                    address(collector),
                    factory.protocolFeeShareBps()
                )
            ),
            true
        );

        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));

        assertEq(address(vault), predicted);
        assertFalse(reentrantToken.callbackSucceeded());
        assertEq(vault.factory(), address(factory));
        assertEq(vault.totalSupply(), params.initialShareSupply);
    }

    function testFeeOnTransferTokenIsRejectedDuringCreationAtomically() public {
        (MockFeeOnTransferToken taxedToken,) = _configureTaxedToken();
        taxedToken.setFeeBps(100);
        VaultInitParams memory params = _paramsWithTaxedToken(taxedToken);
        uint256 senderBalanceBefore = taxedToken.balanceOf(address(this));

        vm.expectPartialRevert(OTFFactory.AssetTransferMismatch.selector);
        factory.createVault(params);

        assertEq(factory.vaultCount(), 0);
        assertEq(factory.creatorNonce(address(this)), 0);
        assertEq(taxedToken.balanceOf(address(this)), senderBalanceBefore);
    }

    function testFeeOnTransferTokenIsRejectedDuringMintAndRedeemAtomically() public {
        (MockFeeOnTransferToken taxedToken,) = _configureTaxedToken();
        ManagedOTFVault vault =
            ManagedOTFVault(factory.createVault(_paramsWithTaxedToken(taxedToken)));
        taxedToken.setFeeBps(100);

        uint256 shares = 10 * ONE;
        uint256[] memory amounts = vault.previewMint(shares);
        taxedToken.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        vm.startPrank(ALICE);
        taxedToken.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        vault.mintWithBasket(shares, ALICE, amounts);
        vm.stopPrank();

        uint256 managerSharesBefore = vault.balanceOf(address(this));
        uint256 taxedBalanceBefore = taxedToken.balanceOf(address(vault));
        uint256[] memory minimums = new uint256[](2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.AssetTransferMismatch.selector);
        vault.redeem(shares, ALICE, address(this), minimums);

        assertEq(vault.balanceOf(ALICE), 0);
        assertEq(vault.balanceOf(address(this)), managerSharesBefore);
        assertEq(taxedToken.balanceOf(address(vault)), taxedBalanceBefore);
    }

    function testExecutorRejectsTaxedTradeInputAtomically() public {
        (MockFeeOnTransferToken taxedToken, MockPriceFeed taxedFeed) = _configureTaxedToken();
        ManagedOTFVault vault =
            ManagedOTFVault(factory.createVault(_paramsWithTaxedToken(taxedToken)));
        taxedToken.mint(address(adapter), 1_000 * ONE);
        adapter.setRate(address(taxedToken), address(tokenB), 1, 1);
        taxedToken.setFeeBps(100);
        vm.warp(START + 7 days);
        taxedFeed.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);
        feedB.setRoundData(2, 100_00000000, block.timestamp, block.timestamp, 2);

        address[] memory assets = new address[](2);
        assets[0] = address(taxedToken);
        assets[1] = address(tokenB);
        uint16[] memory weights = new uint16[](2);
        weights[0] = 4_000;
        weights[1] = 6_000;
        TradeInstruction[] memory trades = new TradeInstruction[](1);
        trades[0] = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(taxedToken),
            tokenOut: address(tokenB),
            amountIn: 100 * ONE,
            minAmountOut: 100 * ONE,
            adapterData: ""
        });

        vm.warp(vault.nextStrategyChangeTime());
        _refreshPrices();
        _refreshPrice(taxedFeed);
        vault.proposeStrategy(assets, _uint256Weights(weights), "Hardened target update.");
        vm.warp(vault.pendingStrategyActivationTime());
        _refreshPrices();
        _refreshPrice(taxedFeed);
        vault.activatePendingStrategy();
        vm.expectPartialRevert(RebalanceExecutor.TokenTransferMismatch.selector);
        vault.executeRebalanceTrades(trades);

        assertEq(taxedToken.balanceOf(address(vault)), 500 * ONE);
        assertEq(tokenB.balanceOf(address(vault)), 500 * ONE);
        assertEq(vault.lastCompletedStrategyTimestamp(), START);
    }

    function testSelfDirectedSharesAndRolesAreRejected() public {
        ManagedOTFVault vault = _createVault();
        uint256[] memory amounts = vault.previewMint(ONE);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidReceiver.selector);
        vault.mintWithBasket(ONE, address(vault), amounts);

        uint256[] memory minimums = new uint256[](2);
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidReceiver.selector);
        vault.redeem(ONE, address(vault), address(this), minimums);

        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidRoleAddress.selector);
        vault.transferOwnership(address(vault));
        vm.expectPartialRevert(ManagedOTFVaultStorage.InvalidRoleAddress.selector);
        vault.setFeeRecipient(address(vault));
    }

    function testMaliciousConstituentCannotReenterMintOrRedeem() public {
        MockReentrantToken reentrantToken = new MockReentrantToken("Reentrant Stock", "REENT", 18);
        MockPriceFeed reentrantFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.setAssetApproved(address(reentrantToken), true);
        oracleRegistry.setOracleConfig(
            address(reentrantToken),
            reentrantFeed,
            25 hours,
            OracleValidationMode.StandardChainlink
        );
        reentrantToken.mint(address(this), 10_000 * ONE);
        reentrantToken.approve(address(factory), type(uint256).max);

        VaultInitParams memory params = _defaultParams();
        params.initialAssets[0] = address(reentrantToken);
        ManagedOTFVault vault = ManagedOTFVault(factory.createVault(params));
        uint256[] memory amounts = vault.previewMint(ONE);
        reentrantToken.mint(ALICE, amounts[0]);
        tokenB.mint(ALICE, amounts[1]);
        reentrantToken.configureCallback(address(vault), abi.encodeCall(vault.accrueFees, ()), true);

        vm.startPrank(ALICE);
        reentrantToken.approve(address(vault), type(uint256).max);
        tokenB.approve(address(vault), type(uint256).max);
        vault.mintWithBasket(ONE, ALICE, amounts);
        vm.stopPrank();

        assertFalse(reentrantToken.callbackSucceeded());
        uint256[] memory minimums = new uint256[](2);
        vm.prank(ALICE);
        vault.redeem(ONE, ALICE, ALICE, minimums);
        assertFalse(reentrantToken.callbackSucceeded());
        assertEq(vault.balanceOf(ALICE), 0);
    }

    function testProtocolFeeSharesCanBeClaimedOnlyByTreasury() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 30 days);
        _refreshPrices();
        vault.accrueFees();
        uint256 protocolShares = vault.balanceOf(address(collector));
        assertGt(protocolShares, 0);

        vm.prank(ATTACKER);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.claimAll(address(vault));

        vm.prank(TREASURY);
        uint256 claimed = collector.claimAll(address(vault));

        assertEq(claimed, protocolShares);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(vault.balanceOf(TREASURY), protocolShares);

        vm.prank(TREASURY);
        assertEq(collector.claimAll(address(vault)), 0);
    }

    function testFeeCollectorTreasuryTransferIsTwoStep() public {
        vm.prank(TREASURY);
        collector.beginTreasuryTransfer(ALICE);

        vm.prank(BOB);
        vm.expectRevert(FeeCollector.NotPendingTreasury.selector);
        collector.acceptTreasuryTransfer();

        vm.prank(ALICE);
        collector.acceptTreasuryTransfer();

        assertEq(collector.treasury(), ALICE);
        assertEq(collector.pendingTreasury(), address(0));
    }

    function _configureTaxedToken()
        private
        returns (MockFeeOnTransferToken taxedToken, MockPriceFeed taxedFeed)
    {
        taxedToken = new MockFeeOnTransferToken("Taxed Stock", "TAX", 18);
        taxedFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.setAssetApproved(address(taxedToken), true);
        oracleRegistry.setOracleConfig(
            address(taxedToken), taxedFeed, 25 hours, OracleValidationMode.StandardChainlink
        );
        taxedToken.mint(address(this), 10_000 * ONE);
        taxedToken.approve(address(factory), type(uint256).max);
    }

    function _paramsWithTaxedToken(MockFeeOnTransferToken taxedToken)
        private
        view
        returns (VaultInitParams memory params)
    {
        params = _defaultParams();
        params.initialAssets[0] = address(taxedToken);
    }
}
