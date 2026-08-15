// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockUniswapV3Router } from "../src/mocks/MockUniswapV3Router.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { UniswapV3Adapter } from "../src/UniswapV3Adapter.sol";
import { TestBase } from "./TestBase.sol";

contract UniswapV3AdapterTest is TestBase {
    MockStockToken private rwaA;
    MockStockToken private rwaB;
    MockStockToken private usdg;
    MockUniswapV3Router private venue;
    UniswapV3Adapter private adapter;

    function setUp() public {
        rwaA = new MockStockToken("RWA A", "A", 18);
        rwaB = new MockStockToken("RWA B", "B", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);
        venue = new MockUniswapV3Router();
        adapter = new UniswapV3Adapter(address(this), address(venue), address(usdg), 3000);
        adapter.setCallerApproved(address(this), true);

        rwaA.mint(address(adapter), 100 ether);
        rwaA.mint(address(venue), 1_000 ether);
        rwaB.mint(address(venue), 1_000 ether);
        usdg.mint(address(venue), 1_000_000e6);
    }

    function testSingleHopExactInputUsesConfiguredSettlementPool() public {
        address[] memory path = new address[](2);
        path[0] = address(rwaA);
        path[1] = address(usdg);

        uint256 received =
            adapter.executeSwap(address(rwaA), address(usdg), 10e6, 9e6, abi.encode(path));

        assertEq(received, 10e6);
        assertEq(usdg.balanceOf(address(this)), 10e6);
        assertEq(rwaA.allowance(address(adapter), address(venue)), 0);
    }

    function testRebalanceUsesSettlementAsOnlyInternalHop() public {
        address[] memory path = new address[](3);
        path[0] = address(rwaA);
        path[1] = address(usdg);
        path[2] = address(rwaB);

        uint256 received = adapter.executeSwap(
            address(rwaA), address(rwaB), 10 ether, 9 ether, abi.encode(path)
        );

        assertEq(received, 10 ether);
        assertEq(rwaB.balanceOf(address(this)), 10 ether);
        assertEq(rwaA.allowance(address(adapter), address(venue)), 0);
    }

    function testExactOutputEntryRefundsUnusedMaximum() public {
        usdg.mint(address(this), 20e6);
        usdg.approve(address(adapter), 20e6);
        address[] memory path = new address[](2);
        path[0] = address(usdg);
        path[1] = address(rwaA);

        uint256 spent =
            adapter.buyExactOutput(address(usdg), address(rwaA), 8e6, 20e6, abi.encode(path));

        assertEq(spent, 8e6);
        assertEq(usdg.balanceOf(address(this)), 12e6);
        assertEq(rwaA.balanceOf(address(this)), 8e6);
        assertEq(usdg.balanceOf(address(adapter)), 0);
        assertEq(usdg.allowance(address(adapter), address(venue)), 0);
    }

    function testInvalidRoutesAndUnauthorizedCallerRevert() public {
        address[] memory missingSettlement = new address[](2);
        missingSettlement[0] = address(rwaA);
        missingSettlement[1] = address(rwaB);

        vm.expectRevert(UniswapV3Adapter.InvalidPath.selector);
        adapter.executeSwap(
            address(rwaA), address(rwaB), 1 ether, 1 ether, abi.encode(missingSettlement)
        );

        address[] memory wrongMiddle = new address[](3);
        wrongMiddle[0] = address(rwaA);
        wrongMiddle[1] = address(rwaB);
        wrongMiddle[2] = address(usdg);
        vm.expectRevert(UniswapV3Adapter.InvalidPath.selector);
        adapter.executeSwap(address(rwaA), address(usdg), 1 ether, 1 ether, abi.encode(wrongMiddle));

        adapter.setCallerApproved(address(this), false);
        vm.expectPartialRevert(UniswapV3Adapter.UnauthorizedCaller.selector);
        adapter.executeSwap(
            address(rwaA), address(usdg), 1 ether, 1 ether, abi.encode(missingSettlement)
        );
    }

    function testExactOutputRejectsWrongSettlementAndMultihop() public {
        address[] memory path = new address[](3);
        path[0] = address(usdg);
        path[1] = address(rwaB);
        path[2] = address(rwaA);

        vm.expectRevert(UniswapV3Adapter.InvalidPath.selector);
        adapter.buyExactOutput(address(usdg), address(rwaA), 1 ether, 2 ether, abi.encode(path));

        vm.expectRevert(UniswapV3Adapter.InvalidAmount.selector);
        adapter.buyExactOutput(address(rwaB), address(rwaA), 1 ether, 2 ether, abi.encode(path));
    }

    function testSlippageRevertsAtomicallyAndLeavesAllowanceCleared() public {
        address[] memory path = new address[](2);
        path[0] = address(rwaA);
        path[1] = address(usdg);

        vm.expectRevert(bytes("SLIPPAGE"));
        adapter.executeSwap(address(rwaA), address(usdg), 10e6, 11e6, abi.encode(path));

        assertEq(rwaA.balanceOf(address(adapter)), 100 ether);
        assertEq(rwaA.allowance(address(adapter), address(venue)), 0);
    }

    function testReportedExactInputOutputMismatchRevertsAtomically() public {
        venue.setReportedOutputBonus(1);
        address[] memory path = new address[](2);
        path[0] = address(rwaA);
        path[1] = address(usdg);

        vm.expectPartialRevert(UniswapV3Adapter.OutputMismatch.selector);
        adapter.executeSwap(address(rwaA), address(usdg), 10e6, 9e6, abi.encode(path));

        assertEq(rwaA.balanceOf(address(adapter)), 100 ether);
        assertEq(usdg.balanceOf(address(this)), 0);
        assertEq(rwaA.allowance(address(adapter), address(venue)), 0);
    }

    function testObservedExactOutputMismatchRevertsAtomically() public {
        venue.setOutputShortfall(1);
        usdg.mint(address(this), 20e6);
        usdg.approve(address(adapter), 20e6);
        address[] memory path = new address[](2);
        path[0] = address(usdg);
        path[1] = address(rwaA);

        vm.expectPartialRevert(UniswapV3Adapter.OutputMismatch.selector);
        adapter.buyExactOutput(address(usdg), address(rwaA), 8e6, 20e6, abi.encode(path));

        assertEq(usdg.balanceOf(address(this)), 20e6);
        assertEq(rwaA.balanceOf(address(this)), 0);
        assertEq(usdg.balanceOf(address(adapter)), 0);
        assertEq(usdg.allowance(address(adapter), address(venue)), 0);
    }
}
