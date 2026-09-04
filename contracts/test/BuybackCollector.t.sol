// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { BuybackCollector } from "../src/BuybackCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { BasketRedeemRequest, FeeShareSwapRequest, SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager
} from "./mocks/MockUniswapV4.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { MockCoreRouter } from "./BootstrapTestBase.sol";
import { TestBase } from "./TestBase.sol";

contract MockBuybackLaunchSource {
    address public immutable otf;
    address public immutable weth;
    address public immutable poolManager;

    constructor(address otf_, address weth_, address poolManager_) {
        otf = otf_;
        weth = weth_;
        poolManager = poolManager_;
    }
}

contract MockApprovedAdapter { }

contract MockBuybackFactory {
    BuybackCollector public immutable buybackCollector;
    address public entryExitRouter;
    mapping(address => bool) public isVault;

    constructor(BuybackCollector collector_) {
        buybackCollector = collector_;
    }

    function register(address vault) external {
        isVault[vault] = true;
    }

    function configureEntryExitRouter(address router) external {
        entryExitRouter = router;
    }
}

contract MockFeeVault is ERC20 {
    address public immutable factory;
    address public immutable buybackCollector;
    address public immutable expenseBeneficiary;
    uint256 public queuedCreatorShares;
    uint256 public queuedBuybackShares;

    constructor(address factory_, address collector_, address beneficiary_)
        ERC20("Fund Shares", "FUND")
    {
        factory = factory_;
        buybackCollector = collector_;
        expenseBeneficiary = beneficiary_;
    }

    function queueFeeShares(uint256 creatorShares, uint256 buybackShares) external {
        queuedCreatorShares += creatorShares;
        queuedBuybackShares += buybackShares;
    }

    function checkpointFees() external returns (uint256 totalFeeShares) {
        uint256 creatorShares = queuedCreatorShares;
        uint256 buybackShares = queuedBuybackShares;
        totalFeeShares = creatorShares + buybackShares;
        if (totalFeeShares == 0) return 0;
        queuedCreatorShares = 0;
        queuedBuybackShares = 0;
        _mint(buybackCollector, totalFeeShares);
        BuybackCollector(buybackCollector).recordFeeShares(creatorShares, buybackShares);
    }
}

contract MockBuybackEntryRouter {
    using SafeTransferLib for address;

    address public immutable factory;
    address public immutable weth;
    mapping(address => bool) public isAdapterApproved;
    bool public misreportOutput;
    bool public usedShareSale;
    uint256 public lastSkipMask;
    uint256 public outputMultiplier = 1;

    constructor(address factory_, address weth_) {
        factory = factory_;
        weth = weth_;
    }

    function setAdapter(address adapter, bool approved) external {
        isAdapterApproved[adapter] = approved;
    }

    function setMisreportOutput(bool enabled) external {
        misreportOutput = enabled;
    }

    function setOutputMultiplier(uint256 multiplier) external {
        require(multiplier != 0, "MULTIPLIER");
        outputMultiplier = multiplier;
    }

    function redeemToToken(
        BasketRedeemRequest calldata request,
        uint256[] calldata,
        SwapLeg[] calldata legs
    ) external returns (uint256 amountOut, address[] memory, uint256[] memory) {
        require(request.outputToken == weth, "OUTPUT");
        lastSkipMask = request.skipMask;
        for (uint256 i = 0; i < legs.length; i++) {
            require(isAdapterApproved[legs[i].adapter], "ADAPTER");
        }
        request.vault.safeTransferFrom(msg.sender, address(this), request.shares);
        amountOut = request.shares * outputMultiplier;
        require(amountOut >= request.minAmountOut, "MINIMUM");
        weth.safeTransfer(msg.sender, amountOut);
        if (misreportOutput) amountOut++;
        return (amountOut, new address[](0), new uint256[](0));
    }

    function swapFeeSharesToWeth(FeeShareSwapRequest calldata request, SwapLeg[] calldata legs)
        external
        returns (uint256 amountOut)
    {
        require(legs.length != 0, "LEGS");
        require(legs[0].tokenIn == request.vault, "INPUT");
        require(legs[legs.length - 1].tokenOut == weth, "OUTPUT");
        for (uint256 i = 0; i < legs.length; i++) {
            require(isAdapterApproved[legs[i].adapter], "ADAPTER");
        }
        request.vault.safeTransferFrom(msg.sender, address(this), request.shares);
        amountOut = request.shares * outputMultiplier;
        require(amountOut >= request.minAmountOut, "MINIMUM");
        weth.safeTransfer(msg.sender, amountOut);
        usedShareSale = true;
        if (misreportOutput) amountOut++;
    }
}

contract BuybackCollectorTest is TestBase {
    address private constant HOLDER = address(0xA11CE);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant OTHER_BENEFICIARY = address(0xCAFE);

    OTFToken private token;
    MockStockToken private weth;
    MockStockToken private basketAsset;
    MockPermit2 private permit2;
    MockUniswapUniversalRouter private universalRouter;
    MockBuybackEntryRouter private entryRouter;
    MockApprovedAdapter private adapter;
    MockBuybackFactory private factory;
    MockFeeVault private feeVault;
    BuybackCollector private collector;

    function setUp() public {
        token = new OTFToken(HOLDER);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        basketAsset = new MockStockToken("Basket Asset", "ASSET", 18);
        MockUniswapV4PoolManager poolManager = new MockUniswapV4PoolManager();
        permit2 = new MockPermit2();
        universalRouter = new MockUniswapUniversalRouter(address(poolManager), address(permit2));
        MockBuybackLaunchSource launch =
            new MockBuybackLaunchSource(address(token), address(weth), address(poolManager));
        collector =
            new BuybackCollector(address(launch), address(universalRouter), address(permit2));
        factory = new MockBuybackFactory(collector);
        feeVault = new MockFeeVault(address(factory), address(collector), BENEFICIARY);
        collector.configureFactory(address(factory));
        factory.register(address(feeVault));
        entryRouter = new MockBuybackEntryRouter(address(factory), address(weth));
        adapter = new MockApprovedAdapter();
        entryRouter.setAdapter(address(adapter), true);
        factory.configureEntryExitRouter(address(entryRouter));

        weth.mint(address(entryRouter), 1_000 ether);
        vm.prank(HOLDER);
        token.transfer(address(universalRouter), 1_000 ether);
    }

    function testFactoryRejectsCollectorBoundToAnotherFactoryAndPairedStackRecordsFees() public {
        BuybackCollector pairedCollector = new BuybackCollector(
            collector.launchManager(), address(universalRouter), address(permit2)
        );
        ManagedOTFVault implementation = new ManagedOTFVault();
        OTFFactory factoryA =
            new OTFFactory(address(implementation), address(pairedCollector), address(token));
        OTFFactory factoryB =
            new OTFFactory(address(implementation), address(pairedCollector), address(token));
        pairedCollector.configureFactory(address(factoryB));
        assertEq(factoryA.routerConfigurator(), factoryB.routerConfigurator());
        assertEq(pairedCollector.factory(), address(factoryB));

        MockCoreRouter routerA = new MockCoreRouter(address(factoryA));
        assertEq(routerA.factory(), address(factoryA));
        vm.expectRevert(
            abi.encodeWithSelector(OTFFactory.InvalidDependency.selector, address(pairedCollector))
        );
        factoryA.configureEntryExitRouter(address(routerA));
        assertEq(factoryA.entryExitRouter(), address(0));

        VaultCreationParams memory params = _canonicalVaultParams();
        vm.expectRevert(OTFFactory.RouterNotConfigured.selector);
        factoryA.createVault(params);

        MockCoreRouter routerB = new MockCoreRouter(address(factoryB));
        assertEq(routerB.factory(), address(factoryB));
        factoryB.configureEntryExitRouter(address(routerB));
        ManagedOTFVault vault = ManagedOTFVault(factoryB.createVault(params));
        assertTrue(factoryB.isVault(address(vault)));

        uint256[] memory amounts = vault.previewMint(1 ether);
        weth.mint(address(routerB), amounts[0]);
        basketAsset.mint(address(routerB), amounts[1]);
        routerB.approveAsset(address(weth), address(vault), amounts[0]);
        routerB.approveAsset(address(basketAsset), address(vault), amounts[1]);
        routerB.mint(vault, 1 ether, address(this), amounts);

        (uint256 creatorShares, uint256 buybackShares) = pairedCollector.feeAccounts(address(vault));
        assertGt(creatorShares, 0);
        assertGt(buybackShares, 0);
        assertEq(vault.balanceOf(address(pairedCollector)), creatorShares + buybackShares);
    }

    function testBeneficiarySettlesCheckpointedFeesIntoWethAndBuybackBurn() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        entryRouter.setOutputMultiplier(2);
        uint256 supplyBefore = token.totalSupply();

        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            200 ether,
            79 ether,
            block.timestamp + 1
        );

        assertEq(creatorWeth, 120 ether);
        assertEq(buybackWeth, 80 ether);
        assertEq(burned, 80 ether);
        assertEq(weth.balanceOf(BENEFICIARY), 120 ether);
        assertEq(token.totalSupply(), supplyBefore - 80 ether);
        assertEq(token.balanceOf(address(collector)), 0);
        assertEq(weth.balanceOf(address(collector)), 0);
        assertEq(feeVault.balanceOf(address(entryRouter)), 100 ether);
        (uint256 creatorPending, uint256 buybackPending) = collector.feeAccounts(address(feeVault));
        assertEq(creatorPending, 0);
        assertEq(buybackPending, 0);
        assertEq(universalRouter.lastIntermediateCurrency(), address(token));
        assertEq(universalRouter.lastFee(), 0);
        assertTrue(universalRouter.lastTickSpacing() == 1);
        assertEq(universalRouter.lastHooks(), collector.launchManager());

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.NothingToSettle.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            1,
            1,
            block.timestamp + 1
        );
    }

    function testRedemptionSettlementPropagatesSkipMask() public {
        feeVault.queueFeeShares(1 ether, 1 ether);

        vm.prank(BENEFICIARY);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            3,
            _route(address(adapter)),
            2 ether,
            1 ether,
            block.timestamp + 1
        );

        assertEq(entryRouter.lastSkipMask(), 3);
    }

    function testOnlyImmutableBeneficiaryCanSettle() public {
        feeVault.queueFeeShares(1 ether, 1 ether);
        vm.prank(OTHER_BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.UnauthorizedBeneficiary.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            2 ether,
            1 ether,
            block.timestamp + 1
        );
        assertEq(feeVault.queuedCreatorShares(), 1 ether);
        assertEq(feeVault.queuedBuybackShares(), 1 ether);
    }

    function testBeneficiaryCanSellFeeSharesThroughMultiHopPath() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        entryRouter.setOutputMultiplier(2);
        uint256 supplyBefore = feeVault.totalSupply();
        uint256 otfSupplyBefore = token.totalSupply();

        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFeesViaShareSale(
            address(feeVault),
            _shareSaleRoute(address(adapter)),
            200 ether,
            79 ether,
            block.timestamp + 1
        );

        assertTrue(entryRouter.usedShareSale());
        assertEq(creatorWeth, 120 ether);
        assertEq(buybackWeth, 80 ether);
        assertEq(burned, 80 ether);
        assertEq(weth.balanceOf(BENEFICIARY), 120 ether);
        assertEq(feeVault.totalSupply(), supplyBefore + 100 ether);
        assertEq(feeVault.balanceOf(address(entryRouter)), 100 ether);
        assertEq(token.totalSupply(), otfSupplyBefore - 80 ether);
        (uint256 creatorPending, uint256 buybackPending) = collector.feeAccounts(address(feeVault));
        assertEq(creatorPending, 0);
        assertEq(buybackPending, 0);

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.NothingToSettle.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            1,
            1,
            block.timestamp + 1
        );
    }

    function testShareSaleOutputMismatchRollsBackAtomically() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        entryRouter.setMisreportOutput(true);

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.BalanceDeltaMismatch.selector);
        collector.settleFeesViaShareSale(
            address(feeVault), _shareSaleRoute(address(adapter)), 100 ether, 1, block.timestamp + 1
        );

        _assertQueuedFeesUntouched();
        assertEq(weth.balanceOf(BENEFICIARY), 0);
        assertFalse(entryRouter.usedShareSale());
    }

    function testUnapprovedBadPathsFakeVaultAndDeadlineAreRejected() public {
        MockApprovedAdapter unapproved = new MockApprovedAdapter();
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.UnapprovedAdapter.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(unapproved)),
            1,
            1,
            block.timestamp + 1
        );

        SwapLeg[] memory badRoute = _route(address(adapter));
        badRoute[0].tokenIn = address(feeVault);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.InvalidRouteToken.selector);
        collector.settleFeesViaRedemption(
            address(feeVault), new uint256[](0), 0, badRoute, 1, 1, block.timestamp + 1
        );

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.DeadlineExpired.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            1,
            1,
            block.timestamp - 1
        );

        MockFeeVault fake = new MockFeeVault(address(factory), address(collector), BENEFICIARY);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.InvalidVault.selector);
        collector.settleFeesViaRedemption(
            address(fake), new uint256[](0), 0, _route(address(adapter)), 1, 1, block.timestamp + 1
        );
    }

    function testBothCallerMinimumsAndExactOutputDeltaRollbackAtomically() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        vm.prank(BENEFICIARY);
        vm.expectRevert();
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            101 ether,
            1,
            block.timestamp + 1
        );
        _assertQueuedFeesUntouched();

        vm.prank(BENEFICIARY);
        vm.expectRevert();
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            100 ether,
            41 ether,
            block.timestamp + 1
        );
        _assertQueuedFeesUntouched();
        assertEq(weth.balanceOf(BENEFICIARY), 0);

        entryRouter.setMisreportOutput(true);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.BalanceDeltaMismatch.selector);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            100 ether,
            1,
            block.timestamp + 1
        );
        _assertQueuedFeesUntouched();
        assertEq(weth.balanceOf(BENEFICIARY), 0);
    }

    function testMultipleVaultAccountsStaySeparated() public {
        MockFeeVault other =
            new MockFeeVault(address(factory), address(collector), OTHER_BENEFICIARY);
        factory.register(address(other));
        feeVault.queueFeeShares(3 ether, 2 ether);
        other.queueFeeShares(7 ether, 3 ether);
        feeVault.checkpointFees();
        other.checkpointFees();

        vm.prank(BENEFICIARY);
        collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            5 ether,
            1 ether,
            block.timestamp + 1
        );

        (uint256 creatorPending, uint256 buybackPending) = collector.feeAccounts(address(other));
        assertEq(creatorPending, 7 ether);
        assertEq(buybackPending, 3 ether);
        assertEq(other.balanceOf(address(collector)), 10 ether);
        assertEq(weth.balanceOf(OTHER_BENEFICIARY), 0);
    }

    function testOneShareRoundingLeavesResidualForBuyback() public {
        feeVault.queueFeeShares(0, 1);
        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFeesViaRedemption(
            address(feeVault),
            new uint256[](0),
            0,
            _route(address(adapter)),
            1,
            1,
            block.timestamp + 1
        );
        assertEq(creatorWeth, 0);
        assertEq(buybackWeth, 1);
        assertEq(burned, 1);
    }

    function testNoAdminAssetWithdrawalOrLegacyBuybackSurfaceExists() public {
        (bool withdrawSuccess,) = address(collector)
            .call(abi.encodeWithSignature("withdraw(address,uint256)", address(token), 1));
        assertFalse(withdrawSuccess);
        (bool legacySuccess,) = address(collector).call(abi.encodeWithSignature("executeBuyback()"));
        assertFalse(legacySuccess);
        (bool settlementSuccess,) = address(collector)
            .call(
                abi.encodeWithSignature(
                    "settleFees(address,uint256[],(address,address,address,uint256,uint256,bytes)[],uint256,uint256,uint256)"
                )
            );
        assertFalse(settlementSuccess);
    }

    function _assertQueuedFeesUntouched() private view {
        assertEq(feeVault.queuedCreatorShares(), 60 ether);
        assertEq(feeVault.queuedBuybackShares(), 40 ether);
        assertEq(feeVault.balanceOf(address(collector)), 0);
        (uint256 creatorPending, uint256 buybackPending) = collector.feeAccounts(address(feeVault));
        assertEq(creatorPending, 0);
        assertEq(buybackPending, 0);
    }

    function _canonicalVaultParams() private view returns (VaultCreationParams memory params) {
        address[] memory constituents = new address[](2);
        constituents[0] = address(weth);
        constituents[1] = address(basketAsset);
        uint256[] memory bootstrapUnits = new uint256[](2);
        bootstrapUnits[0] = 1 ether;
        bootstrapUnits[1] = 1 ether;
        params = VaultCreationParams({
            name: "Canonical Fund",
            symbol: "CANON",
            fundThesis: "Canonical factory and collector trust-boundary coverage.",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: 0,
            mintFeeBps: 200,
            redeemFeeBps: 0,
            constituents: constituents,
            bootstrapBasketUnitsPerOTF: bootstrapUnits
        });
    }

    function _route(address adapter_) private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](1);
        legs[0] = SwapLeg({
            adapter: adapter_,
            tokenIn: address(basketAsset),
            tokenOut: address(weth),
            amountIn: 1,
            minAmountOut: 1,
            data: ""
        });
    }

    function _shareSaleRoute(address adapter_) private view returns (SwapLeg[] memory legs) {
        legs = new SwapLeg[](2);
        legs[0] = SwapLeg({
            adapter: adapter_,
            tokenIn: address(feeVault),
            tokenOut: address(basketAsset),
            amountIn: type(uint256).max,
            minAmountOut: 1,
            data: ""
        });
        legs[1] = SwapLeg({
            adapter: adapter_,
            tokenIn: address(basketAsset),
            tokenOut: address(weth),
            amountIn: type(uint256).max,
            minAmountOut: 1,
            data: ""
        });
    }
}
