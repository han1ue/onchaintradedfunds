// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BuybackCollector } from "../src/BuybackCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import {
    OTFEntryExitRouter,
    BasketMintRequest,
    BasketRedeemRequest,
    SwapLeg
} from "../src/OTFEntryExitRouter.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import { SlashableToken } from "./BootstrapTestBase.sol";
import { MockTradeAdapter } from "./mocks/MockTradeAdapter.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager
} from "./mocks/MockUniswapV4.sol";
import { ShutdownBuybackLaunchSource } from "./BuybackCollectorShutdown.t.sol";
import { TestBase } from "./TestBase.sol";

// The factory, vault, entry/exit router, collector, and OTF token are real contracts.
// Only external markets are mocked, at a fixed 1:1 rate, to isolate fee accounting.
contract BuybackCollectorRedemptionTest is TestBase {
    address private constant CREATOR = address(0xC0FFEE);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant HOLDER = address(0xA11CE);

    OTFToken private otf;
    SlashableToken private weth;
    SlashableToken private stock;
    MockPermit2 private permit2;
    MockUniswapUniversalRouter private universalRouter;
    MockTradeAdapter private adapter;
    BuybackCollector private collector;
    OTFEntryExitRouter private router;
    OTFFactory private factory;
    ManagedOTFVault private vault;

    function setUp() public {
        vm.warp(1_000_000);
        otf = new OTFToken(HOLDER);
        weth = new SlashableToken("Wrapped Ether", "WETH", 18);
        stock = new SlashableToken("Stock", "STOCK", 18);
        MockUniswapV4PoolManager poolManager = new MockUniswapV4PoolManager();
        permit2 = new MockPermit2();
        universalRouter = new MockUniswapUniversalRouter(address(poolManager), address(permit2));
        ShutdownBuybackLaunchSource launch =
            new ShutdownBuybackLaunchSource(address(otf), address(weth), address(poolManager));
        collector =
            new BuybackCollector(address(launch), address(universalRouter), address(permit2));
        factory = new OTFFactory(address(new ManagedOTFVault()), address(collector), address(otf));
        collector.configureFactory(address(factory));
        router = new OTFEntryExitRouter(address(factory), address(this), address(weth));
        factory.configureEntryExitRouter(address(router));
        adapter = new MockTradeAdapter(address(router));
        router.setAdapterApproved(address(adapter), true);
        adapter.setRate(address(weth), address(stock), 1, 1);
        adapter.setRate(address(stock), address(weth), 1, 1);
        stock.mint(address(adapter), 1_000_000 ether);
        weth.mint(address(adapter), 1_000_000 ether);
        vm.prank(HOLDER);
        otf.transfer(address(universalRouter), 1_000_000 ether);
    }

    function testMintFeesSettleWithNonzeroRedemptionFee() public {
        _newVault(200, 100, 0);
        assertGt(vault.balanceOf(address(collector)), 0);
        _assertSettlement();
    }

    function testInvestorRedemptionFeesSettleWithNonzeroRedemptionFee() public {
        _newVault(0, 100, 0);
        _redeemInvestor(10 ether);
        assertEq(vault.balanceOf(address(collector)), 0.1 ether);
        _assertSettlement();
    }

    function testUncheckpointedNavFeesSettleWithOneBasisPointFees() public {
        _newVault(0, 1, 1);
        vm.warp(block.timestamp + 365 days);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertGt(vault.pendingExpenseFeeShares(), 0);
        _assertSettlement();
    }

    function testTenPercentAnnualNavFeesSettleWithMaximumRedemptionFee() public {
        _newVault(0, 100, 1_000);
        vm.warp(block.timestamp + 365 days);
        assertApproxEqAbs(vault.pendingExpenseFeeShares(), uint256(100 ether) / 9, 1);
        _assertSettlement();
        assertApproxEqAbs(vault.accountedBalance(address(weth)), 90 ether, 1);
        assertApproxEqAbs(vault.accountedBalance(address(stock)), 180 ether, 1);
    }

    function testMixedFeesIncludeNavAccruedSinceTheLastCheckpoint() public {
        _newVault(200, 100, 1_000);
        vm.warp(block.timestamp + 90 days);
        assertGt(vault.checkpointFees(), 0);
        _redeemInvestor(10 ether);
        vm.warp(block.timestamp + 30 days);
        assertGt(vault.balanceOf(address(collector)), 0);
        assertGt(vault.pendingExpenseFeeShares(), 0);
        _assertSettlement();
    }

    function testRepeatedSettlementAccruesNewNavFeesWithoutResidualFeeShares() public {
        _newVault(200, 100, 1_000);
        uint256 start = block.timestamp;
        for (uint256 i = 1; i <= 3; i++) {
            vm.warp(start + i * 30 days);
            assertGt(vault.pendingExpenseFeeShares(), 0);
            _assertSettlement();
        }
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.NothingToSettle.selector);
        collector.settleFeesViaRedemption(
            address(vault), new uint256[](2), 0, _exitLegs(), 1, 1, block.timestamp
        );
    }

    function testZeroRedemptionFeeStillSettlesNavFees() public {
        _newVault(200, 0, 1_000);
        vm.warp(block.timestamp + 30 days);
        _assertSettlement();
    }

    function testCollectorRedeemsAllRemainingBackingAfterTheLastInvestorExits() public {
        _newVault(200, 100, 1_000);
        vm.warp(block.timestamp + 30 days);
        _redeemInvestor(100 ether);
        assertFalse(vault.shutdown());
        assertEq(vault.totalSupply(), vault.balanceOf(address(collector)));
        _assertSettlement();
        assertTrue(vault.shutdown());
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.accountedBalance(address(weth)), 0);
        assertEq(vault.accountedBalance(address(stock)), 0);
    }

    function testShutdownSettlesNonzeroFeePolicyAndStopsNavAccrual() public {
        _newVault(200, 100, 1_000);
        vm.warp(block.timestamp + 30 days);
        vm.prank(CREATOR);
        vault.activateEmergencyShutdown();
        uint256 stoppedSupply = vault.totalSupply();
        vm.warp(block.timestamp + 365 days);
        assertEq(vault.pendingExpenseFeeShares(), 0);
        assertEq(vault.totalSupply(), stoppedSupply);
        (, uint256 investorFee,,,) = vault.previewRedeemFee(10 ether, HOLDER);
        assertEq(investorFee, 0);
        _assertSettlement();
    }

    function testCollectorExemptionUsesShareOwnerAndHandlesFeeRounding() public {
        _newVault(200, 1, 1_000);
        // A quote caller or a different receiver cannot change who pays the fee.
        vm.prank(address(collector));
        (uint256 investorNet, uint256 investorFee,,,) = vault.previewRedeemFee(101, HOLDER);
        assertEq(investorNet, 100);
        assertEq(investorFee, 1);
        (uint256 collectorNet, uint256 collectorFee,,,) =
            vault.previewRedeemFee(1, address(collector));
        assertEq(collectorNet, 1);
        assertEq(collectorFee, 0);
        vm.expectPartialRevert(ManagedOTFVaultStorage.ZeroNetShares.selector);
        vault.previewRedeemFee(1, HOLDER);

        uint256 collectorBefore = vault.balanceOf(address(collector));
        uint256[] memory expected = vault.previewRedeem(10 ether, HOLDER, 0);
        (, uint256 fee,,,) = vault.previewRedeemFee(10 ether, HOLDER);
        vm.prank(HOLDER);
        uint256[] memory received = vault.redeemInKind(10 ether, BENEFICIARY, expected, 0);
        assertEq(received[0], expected[0]);
        assertEq(received[1], expected[1]);
        assertEq(vault.balanceOf(address(collector)), collectorBefore + fee);
        _assertSettlement();
    }

    function testSettlementLeavesOtherVaultFeeAccountsUntouched() public {
        _newVault(200, 100, 1_000);
        ManagedOTFVault otherVault = vault;
        uint256 otherShares = otherVault.balanceOf(address(collector));
        (uint256 otherCreator, uint256 otherBuyback) = collector.feeAccounts(address(otherVault));
        _newVault(200, 100, 1_000);
        vm.warp(block.timestamp + 30 days);
        _assertSettlement();
        assertEq(otherVault.balanceOf(address(collector)), otherShares);
        (uint256 creatorAfter, uint256 buybackAfter) = collector.feeAccounts(address(otherVault));
        assertEq(creatorAfter, otherCreator);
        assertEq(buybackAfter, otherBuyback);
        vault = otherVault;
        _assertSettlement();
    }

    function testBuybackFailureRestoresRecordedAndUncheckpointedNavFees() public {
        _newVault(200, 100, 1_000);
        vm.warp(block.timestamp + 30 days);
        uint256 supply = vault.totalSupply();
        uint256 shares = vault.balanceOf(address(collector));
        uint256 pendingNav = vault.pendingExpenseFeeShares();
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        uint256 accountedWeth = vault.accountedBalance(address(weth));
        uint256 accountedStock = vault.accountedBalance(address(stock));
        uint256 otfSupply = otf.totalSupply();
        universalRouter.setSkipInputPull(true);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.BalanceDeltaMismatch.selector);
        collector.settleFeesViaRedemption(
            address(vault), new uint256[](2), 0, _exitLegs(), 1, 1, block.timestamp
        );
        assertEq(vault.totalSupply(), supply);
        assertEq(vault.balanceOf(address(collector)), shares);
        assertEq(vault.pendingExpenseFeeShares(), pendingNav);
        (uint256 creatorAfter, uint256 buybackAfter) = collector.feeAccounts(address(vault));
        assertEq(creatorAfter, creatorShares);
        assertEq(buybackAfter, buybackShares);
        assertEq(vault.accountedBalance(address(weth)), accountedWeth);
        assertEq(vault.accountedBalance(address(stock)), accountedStock);
        assertEq(weth.balanceOf(address(vault)), accountedWeth);
        assertEq(stock.balanceOf(address(vault)), accountedStock);
        assertEq(weth.balanceOf(BENEFICIARY), 0);
        assertEq(otf.totalSupply(), otfSupply);
        _assertOperationClean();
        universalRouter.setSkipInputPull(false);
        _assertSettlement();
    }

    function testFuzzSettlementWithNonzeroNavAndRedemptionFees(
        uint16 mintSeed,
        uint16 redeemSeed,
        uint16 navSeed,
        uint32 elapsedSeed,
        bool checkpoint
    ) public {
        _newVault(
            uint16(bound(mintSeed, 0, 200)),
            uint16(bound(redeemSeed, 1, 100)),
            uint16(bound(navSeed, 1, 1_000))
        );
        vm.warp(block.timestamp + bound(elapsedSeed, 1, 365 days));
        assertGt(vault.pendingExpenseFeeShares(), 0);
        if (checkpoint) assertGt(vault.checkpointFees(), 0);
        _redeemInvestor(10 ether + 1);
        vm.warp(block.timestamp + 1 days);
        _assertSettlement();
    }

    function _newVault(uint16 mintFee, uint16 redeemFee, uint16 navFee) private {
        address[] memory assets = new address[](2);
        assets[0] = address(weth);
        assets[1] = address(stock);
        uint256[] memory units = new uint256[](2);
        units[0] = 1 ether;
        units[1] = 2 ether;
        VaultCreationParams memory params = VaultCreationParams({
            name: "Fee Settlement Fund",
            symbol: "FEES",
            fundThesis: "Tests redemption and annual expense fee settlement.",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: navFee,
            mintFeeBps: mintFee,
            redeemFeeBps: redeemFee,
            constituents: assets,
            bootstrapBasketUnitsPerOTF: units
        });
        vm.prank(CREATOR);
        vault = ManagedOTFVault(factory.createVault(params));
        uint256[] memory amounts = vault.previewMint(100 ether);
        uint256 input = amounts[0] + amounts[1];
        weth.mint(HOLDER, input);
        SwapLeg[] memory entry = new SwapLeg[](1);
        entry[0] =
            SwapLeg(address(adapter), address(weth), address(stock), amounts[1], amounts[1], "");
        vm.startPrank(HOLDER);
        weth.approve(address(router), input);
        router.mintFromToken(
            BasketMintRequest(address(weth), address(vault), input, 100 ether, block.timestamp),
            entry
        );
        vault.approve(address(router), type(uint256).max);
        vm.stopPrank();
        assertEq(vault.balanceOf(HOLDER), 100 ether);
    }

    function _redeemInvestor(uint256 shares) private {
        vault.checkpointFees();
        uint256[] memory amounts = vault.previewRedeem(shares, HOLDER, 0);
        uint256 fee = (shares * vault.redeemFeeBps() + 9_999) / 10_000;
        (, uint256 previewFee,,,) = vault.previewRedeemFee(shares, HOLDER);
        assertEq(previewFee, fee);
        uint256 collectorBefore = vault.balanceOf(address(collector));
        uint256 holderBefore = vault.balanceOf(HOLDER);
        uint256 wethBefore = weth.balanceOf(HOLDER);
        vm.prank(HOLDER);
        (uint256 received,,) = router.redeemToToken(
            BasketRedeemRequest(
                address(vault), address(weth), shares, amounts[0] + amounts[1], 0, block.timestamp
            ),
            amounts,
            _exitLegs()
        );
        assertEq(received, amounts[0] + amounts[1]);
        assertEq(weth.balanceOf(HOLDER) - wethBefore, received);
        assertEq(vault.balanceOf(HOLDER), holderBefore - shares);
        assertEq(vault.balanceOf(address(collector)), collectorBefore + fee);
    }

    function _assertSettlement() private {
        (uint256 creatorShares, uint256 buybackShares) = collector.feeAccounts(address(vault));
        (uint256 pendingNav, uint256 creatorNav, uint256 buybackNav,) = vault.previewExpenseFees();
        creatorShares += creatorNav;
        buybackShares += buybackNav;
        uint256 shares = creatorShares + buybackShares;
        assertGt(creatorShares, 0);
        assertGt(buybackShares, 0);
        assertEq(shares, vault.balanceOf(address(collector)) + pendingNav);
        uint256 supply = vault.totalSupply() + pendingNav;
        uint256 holderShares = vault.balanceOf(HOLDER);
        uint256 accountedWeth = vault.accountedBalance(address(weth));
        uint256 accountedStock = vault.accountedBalance(address(stock));
        uint256[] memory amounts = vault.previewRedeem(shares, address(collector), 0);
        assertEq(amounts[0], accountedWeth * shares / supply);
        assertEq(amounts[1], accountedStock * shares / supply);
        (uint256 net, uint256 fee, uint256 creatorFee, uint256 buybackFee,) =
            vault.previewRedeemFee(shares, address(collector));
        assertEq(net, shares);
        assertEq(fee + creatorFee + buybackFee, 0);
        uint256 expectedWeth = amounts[0] + amounts[1];
        uint256 expectedCreator = expectedWeth * creatorShares / shares;
        uint256 expectedBuyback = expectedWeth - expectedCreator;
        uint256 beneficiaryBefore = weth.balanceOf(BENEFICIARY);
        uint256 otfSupply = otf.totalSupply();

        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFeesViaRedemption(
            address(vault), amounts, 0, _exitLegs(), expectedWeth, expectedBuyback, block.timestamp
        );

        assertEq(creatorWeth, expectedCreator);
        assertEq(buybackWeth, expectedBuyback);
        assertEq(burned, expectedBuyback);
        assertEq(weth.balanceOf(BENEFICIARY) - beneficiaryBefore, expectedCreator);
        assertEq(otfSupply - otf.totalSupply(), burned);
        assertEq(vault.balanceOf(HOLDER), holderShares);
        assertEq(vault.balanceOf(address(collector)), 0);
        assertEq(vault.totalSupply(), supply - shares);
        assertEq(vault.accountedBalance(address(weth)), accountedWeth - amounts[0]);
        assertEq(vault.accountedBalance(address(stock)), accountedStock - amounts[1]);
        assertEq(weth.balanceOf(address(vault)), accountedWeth - amounts[0]);
        assertEq(stock.balanceOf(address(vault)), accountedStock - amounts[1]);
        // Collector settlement removes only its pro-rata backing; holder NAV is preserved.
        if (holderShares != 0) {
            assertApproxEqAbs(
                vault.accountedBalance(address(weth)) * holderShares / vault.totalSupply(),
                accountedWeth * holderShares / supply,
                1
            );
            assertApproxEqAbs(
                vault.accountedBalance(address(stock)) * holderShares / vault.totalSupply(),
                accountedStock * holderShares / supply,
                1
            );
        }
        (creatorShares, buybackShares) = collector.feeAccounts(address(vault));
        assertEq(creatorShares + buybackShares, 0);
        assertEq(vault.pendingExpenseFeeShares(), 0);
        assertEq(vault.checkpointFees(), 0);
        _assertOperationClean();
    }

    function _exitLegs() private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](1);
        legs[0] = SwapLeg(address(adapter), address(stock), address(weth), type(uint256).max, 1, "");
    }

    function _assertOperationClean() private view {
        assertEq(vault.allowance(address(collector), address(router)), 0);
        assertEq(weth.allowance(address(collector), address(permit2)), 0);
        (uint160 permitAmount,,) =
            permit2.allowance(address(collector), address(weth), address(universalRouter));
        assertEq(uint256(permitAmount), 0);
        assertEq(vault.balanceOf(address(router)), 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(stock.balanceOf(address(router)), 0);
        assertEq(weth.balanceOf(address(collector)), 0);
        assertEq(stock.balanceOf(address(collector)), 0);
        assertEq(otf.balanceOf(address(collector)), 0);
    }
}
