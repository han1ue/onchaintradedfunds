// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../src/interfaces/IERC20.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { FormationSnapshot } from "../src/VaultTypes.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { FormationTestBase, MockCoreRouter, SlashableToken } from "./FormationTestBase.sol";

contract ProtocolRebateTest is FormationTestBase {
    OTFToken internal otf;
    MockStockToken internal asset;

    function setUp() public {
        otf = new OTFToken(address(this));
        asset = new MockStockToken("Asset", "AST", 18);
    }

    function testFixedProtocolTokenSupply() public view {
        assertEq(otf.totalSupply(), 1_000_000_000 ether);
        assertEq(otf.MAX_SUPPLY(), 1_000_000_000 ether);
    }

    function testRebateZeroPartialThresholdAndAboveThreshold() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(otf), 4_000, 1_000);

        ManagedOTFVault half = _rebateVault(factory, 500, 1, 0);
        assertEq(factory.effectiveProtocolFeeShareBps(address(half)), 4_000);
        _bootstrapOtf(half, router);
        assertEq(factory.effectiveProtocolFeeShareBps(address(half)), 2_000);

        ManagedOTFVault threshold = _rebateVault(factory, 1_000, 2, 0);
        _bootstrapOtf(threshold, router);
        assertEq(factory.effectiveProtocolFeeShareBps(address(threshold)), 0);

        ManagedOTFVault above = _rebateVault(factory, 1_500, 3, 0);
        _bootstrapOtf(above, router);
        assertEq(factory.effectiveProtocolFeeShareBps(address(above)), 0);
    }

    function testAbsentOtfDisabledIncentiveAndZeroAccountedFailClosed() public {
        (OTFFactory enabled,, MockCoreRouter enabledRouter) =
            _deployFactory(address(otf), 4_000, 1_000);
        MockStockToken second = new MockStockToken("Second", "SEC", 18);
        FormationSnapshot memory absentSnapshot =
            _twoAssetSnapshot(enabled, address(asset), address(second), WAD, WAD, 10);
        ManagedOTFVault absent = _createVault(enabled, absentSnapshot, 0);
        _bootstrap(absent, enabledRouter, _assets(address(asset), address(second)), WAD);
        assertEq(enabled.effectiveProtocolFeeShareBps(address(absent)), 4_000);

        ManagedOTFVault unbootstrapped = _rebateVault(enabled, 1_000, 11, 0);
        assertEq(enabled.effectiveProtocolFeeShareBps(address(unbootstrapped)), 4_000);

        (OTFFactory disabled,, MockCoreRouter disabledRouter) =
            _deployFactory(address(otf), 4_000, 0);
        ManagedOTFVault disabledVault = _rebateVault(disabled, 1_000, 12, 0);
        _bootstrapOtf(disabledVault, disabledRouter);
        assertEq(disabled.effectiveProtocolFeeShareBps(address(disabledVault)), 4_000);
    }

    function testDonationsCannotImproveRebateAndCoverageIsCapped() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(otf), 4_000, 1_000);
        ManagedOTFVault vault = _rebateVault(factory, 500, 20, 0);
        _bootstrapOtf(vault, router);
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 2_000);

        otf.transfer(address(vault), 100 * WAD);
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 2_000);
    }

    function testAnyBackingDeficitFailsClosedToBaseShare() public {
        SlashableToken lossy = new SlashableToken("Lossy", "LOSS", 18);
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(otf), 4_000, 1_000);
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(lossy), address(otf), 9 * WAD, WAD, 21);
        ManagedOTFVault vault = _createVault(factory, snapshot, 0);
        uint256[] memory amounts = vault.previewMint(WAD);
        lossy.mint(address(router), amounts[0]);
        otf.transfer(address(router), amounts[1]);
        router.approveAsset(address(lossy), address(vault), amounts[0]);
        router.approveAsset(address(otf), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 0);

        lossy.slash(address(vault), 1);
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 4_000);
    }

    function testInvalidVaultDataFailsClosed() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(otf), 4_000, 1_000);
        ManagedOTFVault vault = _rebateVault(factory, 1_000, 22, 0);
        _bootstrapOtf(vault, router);
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 0);

        vm.mockCall(
            address(vault),
            abi.encodeWithSelector(vault.formationOtfWeightBps.selector),
            abi.encode(uint16(10_001))
        );
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 4_000);
        vm.clearMockedCalls();

        assertEq(factory.effectiveProtocolFeeShareBps(address(0xBAD)), 4_000);
    }

    function testConservativeRoundingRoundsProtocolShareUp() public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(otf), 3_333, 1_000);
        ManagedOTFVault vault = _rebateVault(factory, 333, 23, 0);
        _bootstrapOtf(vault, router);

        // ceil(3333 * (1000 - 333) / 1000) = 2224.
        assertEq(factory.effectiveProtocolFeeShareBps(address(vault)), 2_224);
    }

    function testRebatedProtocolSplitAndFractionalRemainderAreAppliedToOnlyFee() public {
        (OTFFactory factory, FeeCollector collector, MockCoreRouter router) =
            _deployFactory(address(otf), 4_000, 1_000);
        ManagedOTFVault vault = _rebateVault(factory, 500, 24, 1_000);
        _bootstrapOtf(vault, router);
        vm.warp(block.timestamp + 365 days);
        uint256 feeShares = vault.checkpointFees();

        assertEq(vault.balanceOf(address(collector)), feeShares * 2_000 / 10_000);
        assertEq(vault.balanceOf(BENEFICIARY) + vault.balanceOf(address(collector)), feeShares);
    }

    function _rebateVault(
        OTFFactory factory,
        uint16 otfWeightBps,
        uint256 nonce,
        uint16 expenseRatioBps
    ) private returns (ManagedOTFVault vault) {
        uint256 total = 10_000 * WAD;
        FormationSnapshot memory snapshot = _twoAssetSnapshot(
            factory,
            address(asset),
            address(otf),
            total - uint256(otfWeightBps) * WAD,
            uint256(otfWeightBps) * WAD,
            nonce
        );
        vault = _createVault(factory, snapshot, expenseRatioBps);
    }

    function _bootstrapOtf(ManagedOTFVault vault, MockCoreRouter router) private {
        uint256[] memory amounts = vault.previewMint(WAD);
        asset.mint(address(router), amounts[0]);
        otf.transfer(address(router), amounts[1]);
        router.approveAsset(address(asset), address(vault), amounts[0]);
        router.approveAsset(address(otf), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);
    }

    function _assets(address first, address second) private pure returns (address[] memory assets) {
        assets = new address[](2);
        assets[0] = first;
        assets[1] = second;
    }
}
