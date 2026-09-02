// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { BuybackCollector } from "../src/BuybackCollector.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { BasketRedeemRequest, SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import {
    MockPermit2,
    MockUniswapUniversalRouter,
    MockUniswapV4PoolManager
} from "./mocks/MockUniswapV4.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
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
    mapping(address => bool) public isVault;

    constructor(BuybackCollector collector_) {
        buybackCollector = collector_;
    }

    function register(address vault, address beneficiary) external {
        isVault[vault] = true;
        buybackCollector.registerVault(vault, beneficiary);
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
        factory.register(address(feeVault), BENEFICIARY);
        entryRouter = new MockBuybackEntryRouter(address(factory), address(weth));
        adapter = new MockApprovedAdapter();
        entryRouter.setAdapter(address(adapter), true);
        collector.configureEntryExitRouter(address(entryRouter));

        weth.mint(address(entryRouter), 1_000 ether);
        vm.prank(HOLDER);
        token.transfer(address(universalRouter), 1_000 ether);
    }

    function testBeneficiarySettlesCheckpointedFeesIntoWethAndBuybackBurn() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        entryRouter.setOutputMultiplier(2);
        uint256 supplyBefore = token.totalSupply();

        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFees(
            address(feeVault),
            new uint256[](0),
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
        (uint256 creatorPending, uint256 buybackPending, address beneficiary) =
            collector.feeAccounts(address(feeVault));
        assertEq(creatorPending, 0);
        assertEq(buybackPending, 0);
        assertEq(beneficiary, BENEFICIARY);
        assertEq(universalRouter.lastIntermediateCurrency(), address(token));
        assertEq(universalRouter.lastFee(), 0);
        assertTrue(universalRouter.lastTickSpacing() == 1);
        assertEq(universalRouter.lastHooks(), collector.launchManager());

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.NothingToSettle.selector);
        collector.settleFees(
            address(feeVault), new uint256[](0), _route(address(adapter)), 1, 1, block.timestamp + 1
        );
    }

    function testOnlyImmutableBeneficiaryCanSettle() public {
        feeVault.queueFeeShares(1 ether, 1 ether);
        vm.prank(OTHER_BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.UnauthorizedBeneficiary.selector);
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
            _route(address(adapter)),
            2 ether,
            1 ether,
            block.timestamp + 1
        );
        assertEq(feeVault.queuedCreatorShares(), 1 ether);
        assertEq(feeVault.queuedBuybackShares(), 1 ether);
    }

    function testUnapprovedBadPathsFakeVaultAndDeadlineAreRejected() public {
        MockApprovedAdapter unapproved = new MockApprovedAdapter();
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.UnapprovedAdapter.selector);
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
            _route(address(unapproved)),
            1,
            1,
            block.timestamp + 1
        );

        SwapLeg[] memory badRoute = _route(address(adapter));
        badRoute[0].tokenIn = address(feeVault);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.InvalidRouteToken.selector);
        collector.settleFees(
            address(feeVault), new uint256[](0), badRoute, 1, 1, block.timestamp + 1
        );

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.DeadlineExpired.selector);
        collector.settleFees(
            address(feeVault), new uint256[](0), _route(address(adapter)), 1, 1, block.timestamp - 1
        );

        MockFeeVault fake = new MockFeeVault(address(factory), address(collector), BENEFICIARY);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(BuybackCollector.InvalidVault.selector);
        collector.settleFees(
            address(fake), new uint256[](0), _route(address(adapter)), 1, 1, block.timestamp + 1
        );
    }

    function testBothCallerMinimumsAndExactOutputDeltaRollbackAtomically() public {
        feeVault.queueFeeShares(60 ether, 40 ether);
        vm.prank(BENEFICIARY);
        vm.expectRevert();
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
            _route(address(adapter)),
            101 ether,
            1,
            block.timestamp + 1
        );
        _assertQueuedFeesUntouched();

        vm.prank(BENEFICIARY);
        vm.expectRevert();
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
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
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
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
        factory.register(address(other), OTHER_BENEFICIARY);
        feeVault.queueFeeShares(3 ether, 2 ether);
        other.queueFeeShares(7 ether, 3 ether);
        feeVault.checkpointFees();
        other.checkpointFees();

        vm.prank(BENEFICIARY);
        collector.settleFees(
            address(feeVault),
            new uint256[](0),
            _route(address(adapter)),
            5 ether,
            1 ether,
            block.timestamp + 1
        );

        (uint256 creatorPending, uint256 buybackPending, address beneficiary) =
            collector.feeAccounts(address(other));
        assertEq(creatorPending, 7 ether);
        assertEq(buybackPending, 3 ether);
        assertEq(beneficiary, OTHER_BENEFICIARY);
        assertEq(other.balanceOf(address(collector)), 10 ether);
        assertEq(weth.balanceOf(OTHER_BENEFICIARY), 0);
    }

    function testOneShareRoundingLeavesResidualForBuyback() public {
        feeVault.queueFeeShares(0, 1);
        vm.prank(BENEFICIARY);
        (uint256 creatorWeth, uint256 buybackWeth, uint256 burned) = collector.settleFees(
            address(feeVault), new uint256[](0), _route(address(adapter)), 1, 1, block.timestamp + 1
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
    }

    function _assertQueuedFeesUntouched() private view {
        assertEq(feeVault.queuedCreatorShares(), 60 ether);
        assertEq(feeVault.queuedBuybackShares(), 40 ether);
        assertEq(feeVault.balanceOf(address(collector)), 0);
        (uint256 creatorPending, uint256 buybackPending,) = collector.feeAccounts(address(feeVault));
        assertEq(creatorPending, 0);
        assertEq(buybackPending, 0);
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
}
