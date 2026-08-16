// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { OracleValidationMode } from "../src/interfaces/IOracleRegistry.sol";
import { MockPriceFeed } from "../src/mocks/MockPriceFeed.sol";
import { AssetPricingConfig, VaultInitParams } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract ProtocolTokenIncentivesTest is ProtocolTestBase {
    OTFToken internal otfToken;
    MockPriceFeed internal otfFeed;

    function setUp() public override {
        super.setUp();

        otfToken = new OTFToken(address(this));
        otfFeed = new MockPriceFeed(8, 100_00000000);
        assetRegistry.registerAsset(address(otfToken));
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
        assertEq(otfToken.MAX_SUPPLY(), 1_000_000_000 * ONE);
        assertEq(otfToken.totalSupply(), 1_000_000_000 * ONE);
        assertEq(otfToken.balanceOf(address(this)), 1_000_000_000 * ONE);
        assertGt(bytes(otfToken.tokenURI()).length, 900);
    }

    function testOTFTokenRejectsInvalidGenesis() public {
        vm.expectRevert(OTFToken.ZeroAddress.selector);
        new OTFToken(address(0));
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

    function testTreasuryCanClaimAndRedeemProtocolFeesForManualBuybacks() public {
        ManagedOTFVault vault = _createVault();
        vm.warp(START + 30 days);
        _refreshAllPrices();
        vault.accrueFees();

        vm.prank(TREASURY);
        uint256 claimedShares = collector.claimAll(address(vault));
        assertGt(claimedShares, 0);

        uint256 tokenABefore = tokenA.balanceOf(TREASURY);
        uint256 tokenBBefore = tokenB.balanceOf(TREASURY);
        uint256[] memory minimums = new uint256[](vault.assetCount());
        vm.prank(TREASURY);
        vault.redeem(claimedShares, TREASURY, TREASURY, minimums);

        assertEq(vault.balanceOf(TREASURY), 0);
        assertGt(tokenA.balanceOf(TREASURY), tokenABefore);
        assertGt(tokenB.balanceOf(TREASURY), tokenBBefore);
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
        params.initialPricingConfigs = new AssetPricingConfig[](3);
        params.initialPricingConfigs[0] = _directPricing(address(feedA));
        params.initialPricingConfigs[1] = _directPricing(address(feedB));
        params.initialPricingConfigs[2] = _directPricing(address(otfFeed));

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
