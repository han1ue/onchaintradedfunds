// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

contract MockBuybackEntryRouter {
    using SafeTransferLib for address;

    address public immutable weth;
    mapping(address => bool) public isAdapterApproved;

    constructor(address weth_) {
        weth = weth_;
    }

    function setAdapter(address adapter, bool approved) external {
        isAdapterApproved[adapter] = approved;
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
        amountOut = request.shares;
        require(amountOut >= request.minAmountOut, "MINIMUM");
        weth.safeTransfer(msg.sender, amountOut);
        return (amountOut, new address[](0), new uint256[](0));
    }
}

contract BuybackCollectorTest is TestBase {
    address private constant HOLDER = address(0xA11CE);
    address private constant OPERATOR = address(0xCAFE);

    OTFToken private token;
    MockStockToken private weth;
    MockStockToken private feeShares;
    MockStockToken private basketAsset;
    MockPermit2 private permit2;
    MockUniswapUniversalRouter private universalRouter;
    MockBuybackEntryRouter private entryRouter;
    MockApprovedAdapter private adapter;
    BuybackCollector private collector;

    function setUp() public {
        token = new OTFToken(HOLDER);
        weth = new MockStockToken("Wrapped Ether", "WETH", 18);
        feeShares = new MockStockToken("Fund Shares", "FUND", 18);
        basketAsset = new MockStockToken("Basket Asset", "ASSET", 18);
        MockUniswapV4PoolManager poolManager = new MockUniswapV4PoolManager();
        permit2 = new MockPermit2();
        universalRouter = new MockUniswapUniversalRouter(address(poolManager), address(permit2));
        MockBuybackLaunchSource launch =
            new MockBuybackLaunchSource(address(token), address(weth), address(poolManager));
        entryRouter = new MockBuybackEntryRouter(address(weth));
        adapter = new MockApprovedAdapter();
        entryRouter.setAdapter(address(adapter), true);
        collector = new BuybackCollector(
            OPERATOR, address(launch), address(universalRouter), address(permit2)
        );
        collector.configureEntryExitRouter(address(entryRouter));

        feeShares.mint(address(collector), 100 ether);
        weth.mint(address(entryRouter), 100 ether);
        vm.prank(HOLDER);
        token.transfer(address(universalRouter), 100 ether);
    }

    function testApprovedTypedRouteRedeemsBuysAndBurns() public {
        SwapLeg[] memory legs = _route(address(adapter));
        uint256 supplyBefore = token.totalSupply();
        vm.prank(OPERATOR);
        (uint256 wethSpent, uint256 burned) = collector.executeBuyback(
            address(feeShares),
            100 ether,
            new uint256[](0),
            legs,
            100 ether,
            99 ether,
            block.timestamp + 1
        );
        assertEq(wethSpent, 100 ether);
        assertEq(burned, 100 ether);
        assertEq(token.totalSupply(), supplyBefore - 100 ether);
        assertEq(token.balanceOf(address(collector)), 0);
        assertEq(feeShares.balanceOf(address(entryRouter)), 100 ether);
        assertEq(universalRouter.lastIntermediateCurrency(), address(token));
        assertEq(universalRouter.lastFee(), 0);
        assertTrue(universalRouter.lastTickSpacing() == 1);
        assertEq(universalRouter.lastHooks(), collector.launchManager());
    }

    function testUnapprovedAdapterDeadlineAndMinimumsAreEnforced() public {
        MockApprovedAdapter unapproved = new MockApprovedAdapter();
        vm.prank(OPERATOR);
        vm.expectPartialRevert(BuybackCollector.UnapprovedAdapter.selector);
        collector.executeBuyback(
            address(feeShares),
            1 ether,
            new uint256[](0),
            _route(address(unapproved)),
            1 ether,
            1 ether,
            block.timestamp + 1
        );
        vm.prank(OPERATOR);
        vm.expectPartialRevert(BuybackCollector.DeadlineExpired.selector);
        collector.executeBuyback(
            address(feeShares),
            1 ether,
            new uint256[](0),
            _route(address(adapter)),
            1 ether,
            1 ether,
            block.timestamp - 1
        );

        vm.prank(OPERATOR);
        vm.expectRevert();
        collector.executeBuyback(
            address(feeShares),
            1 ether,
            new uint256[](0),
            _route(address(adapter)),
            1 ether,
            2 ether,
            block.timestamp + 1
        );
    }

    function testNoAdminAssetWithdrawalSurfaceExists() public {
        vm.prank(OPERATOR);
        (bool success,) = address(collector)
            .call(abi.encodeWithSignature("withdraw(address,uint256)", address(token), 1));
        assertFalse(success);
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
