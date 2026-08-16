// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFBuyback } from "../src/OTFBuyback.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { OracleValidationMode } from "../src/interfaces/IOracleRegistry.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockTradeAdapter } from "../src/mocks/MockTradeAdapter.sol";
import { VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ProtocolTokenIncentivesTest is ProtocolTestBase {
    OTFToken internal otfToken;
    MockPriceFeed internal otfFeed;

    function setUp() public override {
        super.setUp();

        otfToken = new OTFToken(address(this), 100_000_000 * ONE);
        otfFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.setAssetApproved(address(otfToken), true);
        oracleRegistry.setOracleConfig(
            address(otfToken), otfFeed, 25 hours, OracleValidationMode.StandardChainlink
        );
        otfToken.approve(address(factory), type(uint256).max);
        factory.configureProtocolToken(address(otfToken), 1_000);
    }

    function testOTFTokenHasFixedInitialSupply() public view {
        assertEq(otfToken.name(), "Onchain Traded Funds");
        assertEq(otfToken.symbol(), "OTF");
        assertEq(otfToken.decimals(), 18);
        assertEq(otfToken.totalSupply(), 100_000_000 * ONE);
        assertEq(otfToken.balanceOf(address(this)), 100_000_000 * ONE);
    }

    function testOTFTokenRejectsInvalidGenesis() public {
        vm.expectRevert(OTFToken.ZeroAddress.selector);
        new OTFToken(address(0), ONE);

        vm.expectRevert(OTFToken.ZeroInitialSupply.selector);
        new OTFToken(address(this), 0);
    }

    function testFullThresholdRedirectsAllProtocolFeesToManager() public {
        ManagedOTFVault vault = _createProtocolTokenVault(1_000);
        assertEq(vault.currentWeight(address(otfToken)), 1_000);
        assertEq(vault.effectiveProtocolFeeShareBps(), 0);

        vm.warp(START + 365 days);
        _refreshAllPrices();
        uint256 feeShares = vault.accrueFees();

        assertGt(feeShares, 0);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(vault.balanceOf(FEE_RECIPIENT), feeShares);
    }

    function testHalfThresholdHalvesProtocolFeeShare() public {
        ManagedOTFVault vault = _createProtocolTokenVault(500);
        assertEq(vault.currentWeight(address(otfToken)), 500);
        assertEq(vault.effectiveProtocolFeeShareBps(), 750);

        vm.warp(START + 365 days);
        _refreshAllPrices();
        uint256 feeShares = vault.accrueFees();
        uint256 expectedProtocolShares = feeShares * 750 / 10_000;

        assertEq(vault.balanceOf(address(collector)), expectedProtocolShares);
        assertEq(vault.balanceOf(FEE_RECIPIENT), feeShares - expectedProtocolShares);
    }

    function testAdminCanChangeOrDisableFullRebateThreshold() public {
        ManagedOTFVault vault = _createProtocolTokenVault(500);
        assertEq(vault.effectiveProtocolFeeShareBps(), 750);

        factory.setProtocolTokenFullRebateBps(500);
        assertEq(vault.effectiveProtocolFeeShareBps(), 0);

        factory.setProtocolTokenFullRebateBps(0);
        assertEq(vault.effectiveProtocolFeeShareBps(), 1_500);

        vm.prank(ALICE);
        vm.expectRevert(OTFFactory.NotOwner.selector);
        factory.setProtocolTokenFullRebateBps(1_000);
    }

    function testProtocolTokenIdentityCannotBeChanged() public {
        vm.expectRevert(OTFFactory.ProtocolTokenAlreadyConfigured.selector);
        factory.configureProtocolToken(address(tokenC), 500);

        vm.expectPartialRevert(OTFFactory.InvalidProtocolTokenThreshold.selector);
        factory.setProtocolTokenFullRebateBps(10_001);
    }

    function testMissingOrStaleRebateOracleFailsClosedWithoutBlockingRedemption() public {
        ManagedOTFVault vaultWithoutOtf = _createVault();
        assertEq(vaultWithoutOtf.effectiveProtocolFeeShareBps(), 1_500);

        ManagedOTFVault vault = _createProtocolTokenVault(500);
        assertEq(vault.effectiveProtocolFeeShareBps(), 750);

        vm.warp(START + 25 hours + 1);
        assertEq(vault.effectiveProtocolFeeShareBps(), 1_500);
        uint256[] memory minimums = new uint256[](vault.assetCount());
        vault.redeem(ONE, address(this), address(this), minimums);

        assertGt(vault.balanceOf(address(collector)), 0);
    }

    function testFeeCollectorAllocatesConfiguredPercentageToBuybacks() public {
        MockStockToken feeAsset = new MockStockToken("Fee asset", "FEEA", 18);
        feeAsset.mint(address(collector), 1_000 * ONE);

        vm.prank(TREASURY);
        collector.setBuybackConfig(BOB, 2_500);

        vm.prank(TREASURY);
        uint256 claimed = collector.claimAll(address(feeAsset));

        assertEq(claimed, 1_000 * ONE);
        assertEq(feeAsset.balanceOf(BOB), 250 * ONE);
        assertEq(feeAsset.balanceOf(TREASURY), 750 * ONE);
    }

    function testOnlyTreasuryCanConfigureBuybackAllocation() public {
        vm.prank(ALICE);
        vm.expectRevert(FeeCollector.NotTreasury.selector);
        collector.setBuybackConfig(BOB, 2_500);

        vm.prank(TREASURY);
        vm.expectPartialRevert(FeeCollector.InvalidBuybackAllocation.selector);
        collector.setBuybackConfig(BOB, 10_001);

        vm.prank(TREASURY);
        vm.expectRevert(FeeCollector.BuybackRecipientRequired.selector);
        collector.setBuybackConfig(address(0), 1);
    }

    function testBuybackTradesOnlyThroughApprovedAdaptersAndReleasesToFixedRecipient() public {
        OTFBuyback buyback = new OTFBuyback(address(this), address(otfToken), TREASURY);
        MockStockToken feeAsset = new MockStockToken("Fee asset", "FEEA", 18);
        MockTradeAdapter buybackAdapter = new MockTradeAdapter();
        feeAsset.mint(address(buyback), 100 * ONE);
        otfToken.transfer(address(buybackAdapter), 1_000 * ONE);
        buybackAdapter.setRate(address(feeAsset), address(otfToken), 2, 1);

        vm.expectPartialRevert(OTFBuyback.UnapprovedAdapter.selector);
        buyback.executeBuyback(address(buybackAdapter), address(feeAsset), 40 * ONE, 80 * ONE, "");

        buyback.setTradeAdapterApproved(address(buybackAdapter), true);
        uint256 amountOut = buyback.executeBuyback(
            address(buybackAdapter), address(feeAsset), 40 * ONE, 80 * ONE, ""
        );
        assertEq(amountOut, 80 * ONE);
        assertEq(otfToken.balanceOf(address(buyback)), 80 * ONE);

        vm.prank(ALICE);
        uint256 released = buyback.releaseAllPurchasedTokens();
        assertEq(released, 80 * ONE);
        assertEq(otfToken.balanceOf(TREASURY), 80 * ONE);

        vm.prank(ALICE);
        vm.expectRevert(OTFBuyback.NotOperator.selector);
        buyback.executeBuyback(address(buybackAdapter), address(feeAsset), 10 * ONE, 20 * ONE, "");
    }

    function testAllocatedProtocolFeeSharesCanBeRedeemedByBuyback() public {
        OTFBuyback buyback = new OTFBuyback(address(this), address(otfToken), TREASURY);
        vm.prank(TREASURY);
        collector.setBuybackConfig(address(buyback), 2_000);

        ManagedOTFVault vault = _createVault();
        vm.warp(START + 30 days);
        _refreshAllPrices();
        vault.accrueFees();

        vm.prank(TREASURY);
        collector.claimAll(address(vault));
        uint256 allocatedFeeShares = vault.balanceOf(address(buyback));
        assertGt(allocatedFeeShares, 0);

        uint256[] memory minimums = new uint256[](vault.assetCount());
        buyback.redeemFeeShares(address(vault), allocatedFeeShares, minimums);

        assertEq(vault.balanceOf(address(buyback)), 0);
        assertGt(tokenA.balanceOf(address(buyback)), 0);
        assertGt(tokenB.balanceOf(address(buyback)), 0);
    }

    function _createProtocolTokenVault(uint16 otfWeightBps)
        private
        returns (ManagedOTFVault vault)
    {
        VaultInitParams memory params = _defaultParams();
        params.initialAssets = new address[](3);
        params.initialAssets[0] = address(tokenA);
        params.initialAssets[1] = address(tokenB);
        params.initialAssets[2] = address(otfToken);

        uint16 remainingWeight = uint16(10_000 - otfWeightBps);
        params.initialTargetWeightsBps = new uint16[](3);
        params.initialTargetWeightsBps[0] = remainingWeight / 2;
        params.initialTargetWeightsBps[1] = remainingWeight - remainingWeight / 2;
        params.initialTargetWeightsBps[2] = otfWeightBps;

        params.initialAmounts = new uint256[](3);
        params.initialAmounts[0] = uint256(params.initialTargetWeightsBps[0]) * ONE / 10;
        params.initialAmounts[1] = uint256(params.initialTargetWeightsBps[1]) * ONE / 10;
        params.initialAmounts[2] = uint256(otfWeightBps) * ONE / 10;
        params.deploymentSalt = keccak256(abi.encode("otf-incentive", otfWeightBps));

        vault = ManagedOTFVault(factory.createVault(params));
    }

    function _refreshAllPrices() private {
        _refreshPrices();
        _refreshPrice(otfFeed);
    }
}
