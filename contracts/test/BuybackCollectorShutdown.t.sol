// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BuybackCollector } from "../src/BuybackCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFEntryExitRouter, SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { SlashableToken } from "./BootstrapTestBase.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager
} from "./mocks/MockUniswapV4.sol";
import { TestBase } from "./TestBase.sol";

contract ShutdownBuybackLaunchSource {
    address public immutable otf;
    address public immutable weth;
    address public immutable poolManager;

    constructor(address otf_, address weth_, address poolManager_) {
        otf = otf_;
        weth = weth_;
        poolManager = poolManager_;
    }
}

contract BuybackCollectorShutdownTest is TestBase {
    address private constant CREATOR = address(0xC0FFEE);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant HOLDER = address(0xA11CE);

    OTFToken private otf;
    SlashableToken private weth;
    MockPermit2 private permit2;
    MockUniswapUniversalRouter private universalRouter;
    BuybackCollector private collector;
    OTFEntryExitRouter private entryRouter;
    ManagedOTFVault private vault;

    function setUp() public {
        vm.warp(1_000_000);
        otf = new OTFToken(HOLDER);
        weth = new SlashableToken("Wrapped Ether", "WETH", 18);
        MockUniswapV4PoolManager poolManager = new MockUniswapV4PoolManager();
        permit2 = new MockPermit2();
        universalRouter = new MockUniswapUniversalRouter(address(poolManager), address(permit2));
        ShutdownBuybackLaunchSource launch =
            new ShutdownBuybackLaunchSource(address(otf), address(weth), address(poolManager));
        collector =
            new BuybackCollector(address(launch), address(universalRouter), address(permit2));

        ManagedOTFVault implementation = new ManagedOTFVault();
        OTFFactory factory =
            new OTFFactory(address(implementation), address(collector), address(otf));
        collector.configureFactory(address(factory));
        entryRouter = new OTFEntryExitRouter(address(factory), address(this), address(weth));
        factory.configureEntryExitRouter(address(entryRouter));

        address[] memory assets = new address[](2);
        assets[0] = address(weth);
        assets[1] = address(otf);
        uint256[] memory units = new uint256[](2);
        units[0] = 1 ether;
        units[1] = 1 ether;
        VaultCreationParams memory params = VaultCreationParams({
            name: "Fee Residual OTF",
            symbol: "FEE",
            fundThesis: "Tests fee-share settlement after shutdown.",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: 1_000,
            mintFeeBps: 0,
            redeemFeeBps: 0,
            constituents: assets,
            bootstrapBasketUnitsPerOTF: units
        });
        vm.prank(CREATOR);
        vault = ManagedOTFVault(factory.createVault(params));

        uint256[] memory amounts = vault.previewMint(1 ether);
        weth.mint(address(entryRouter), amounts[0]);
        vm.prank(HOLDER);
        assertTrue(otf.transfer(address(entryRouter), amounts[1]));
        vm.prank(address(entryRouter));
        weth.approve(address(vault), amounts[0]);
        vm.prank(address(entryRouter));
        otf.approve(address(vault), amounts[1]);
        vm.prank(address(entryRouter));
        vault.routerMint(1 ether, HOLDER, amounts);

        vm.prank(HOLDER);
        assertTrue(otf.transfer(address(universalRouter), 1_000 ether));
    }

    function testLowSupplyCollectorResidualSettlesAfterShutdown() public {
        _redeemHolderAndTriggerLowSupplyShutdown();
        uint256 collectorShares = vault.balanceOf(address(collector));
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        uint256 wethAvailable = vault.previewRedeem(collectorShares, address(collector), 0)[0];
        uint256 expectedCreatorWeth = wethAvailable * creatorShares / collectorShares;
        uint256 supplyBefore = otf.totalSupply();

        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = _settle(wethAvailable, 1);

        assertEq(creatorWeth, expectedCreatorWeth);
        assertEq(buybackWeth, wethAvailable - expectedCreatorWeth);
        assertEq(burned, buybackWeth);
        assertEq(weth.balanceOf(BENEFICIARY), creatorWeth);
        assertEq(otf.totalSupply(), supplyBefore - burned);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.accountedBalance(address(weth)), 0);
        assertEq(weth.balanceOf(address(vault)), 0);
        _assertSettlementClean();
        assertGt(creatorShares, 0);
        assertGt(buybackShares, 0);
    }

    function testPermissionlessDeficitShutdownCheckpointsAndSettlesAvailableBacking() public {
        vm.warp(block.timestamp + 180 days);
        uint256 pending = vault.pendingExpenseFeeShares();
        assertGt(pending, 0);
        weth.slash(address(vault), 0.5 ether);

        vm.prank(address(0xD1E7));
        vault.activateEmergencyShutdown();

        assertTrue(vault.shutdown());
        assertEq(vault.balanceOf(address(collector)), pending);
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        assertEq(creatorShares + buybackShares, pending);
        uint256 wethAvailable = vault.previewRedeem(pending, address(collector), 0)[0];
        assertGt(wethAvailable, 0);

        _settle(wethAvailable, 1);

        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(vault.totalSupply(), 1 ether);
        _assertSettlementClean();
    }

    function testBuybackFailureRestoresSharesFeeAccountsAndVaultAccounting() public {
        _redeemHolderAndTriggerLowSupplyShutdown();
        uint256 collectorShares = vault.balanceOf(address(collector));
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        uint256 accounted = vault.accountedBalance(address(weth));
        uint256 vaultWeth = weth.balanceOf(address(vault));
        uint256 supply = vault.totalSupply();
        universalRouter.setSkipInputPull(true);

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.BalanceDeltaMismatch.selector);
        collector.settleFeesViaRedemption(
            address(vault),
            _singleMinimum(accounted),
            2,
            new SwapLeg[](0),
            accounted,
            1,
            block.timestamp + 1
        );

        assertEq(vault.balanceOf(address(collector)), collectorShares);
        assertEq(vault.totalSupply(), supply);
        assertEq(vault.accountedBalance(address(weth)), accounted);
        assertEq(weth.balanceOf(address(vault)), vaultWeth);
        (uint256 creatorAfter, uint256 buybackAfter) = collector.feeAccounts(address(vault));
        assertEq(creatorAfter, creatorShares);
        assertEq(buybackAfter, buybackShares);
        assertEq(weth.balanceOf(BENEFICIARY), 0);
        _assertOperationBalancesClean();
    }

    function _redeemHolderAndTriggerLowSupplyShutdown() private {
        vm.warp(block.timestamp + 1 days);
        uint256 pending = vault.pendingExpenseFeeShares();
        assertGt(pending, 0);
        assertLt(pending, 0.01 ether);

        vm.prank(HOLDER);
        vault.redeemInKind(1 ether, HOLDER, new uint256[](2), 0);

        assertTrue(vault.shutdown());
        assertEq(vault.totalSupply(), pending);
        assertEq(vault.balanceOf(address(collector)), pending);
    }

    function _settle(uint256 minimumWeth, uint256 minimumOtf)
        private
        returns (uint256 creatorWeth, uint256 buybackWeth, uint256 burned)
    {
        vm.prank(BENEFICIARY);
        return collector.settleFeesViaRedemption(
            address(vault),
            _singleMinimum(minimumWeth),
            2,
            new SwapLeg[](0),
            minimumWeth,
            minimumOtf,
            block.timestamp + 1
        );
    }

    function _singleMinimum(uint256 amount) private pure returns (uint256[] memory minimums) {
        minimums = new uint256[](2);
        minimums[0] = amount;
    }

    function _assertSettlementClean() private view {
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        assertEq(creatorShares, 0);
        assertEq(buybackShares, 0);
        _assertOperationBalancesClean();
    }

    function _assertOperationBalancesClean() private view {
        assertEq(vault.allowance(address(collector), address(entryRouter)), 0);
        assertEq(weth.allowance(address(collector), address(permit2)), 0);
        (uint160 permitAmount,,) =
            permit2.allowance(address(collector), address(weth), address(universalRouter));
        assertEq(uint256(permitAmount), 0);
        assertEq(vault.balanceOf(address(entryRouter)), 0);
        assertEq(weth.balanceOf(address(entryRouter)), 0);
        assertEq(weth.balanceOf(address(collector)), 0);
        assertEq(otf.balanceOf(address(collector)), 0);
    }
}
