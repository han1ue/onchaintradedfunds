// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../src/interfaces/IERC20.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { UniswapV2Adapter } from "../src/UniswapV2Adapter.sol";
import { TestBase } from "./TestBase.sol";

contract MockUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        require(amountIn >= amountOutMin, "SLIPPAGE");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        IERC20(path[path.length - 1]).transfer(to, amountIn);
        amounts = _amounts(path.length, amountIn);
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        require(amountOut <= amountInMax, "MAX_INPUT");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountOut);
        IERC20(path[path.length - 1]).transfer(to, amountOut);
        amounts = _amounts(path.length, amountOut);
    }

    function _amounts(uint256 length, uint256 amount) private pure returns (uint256[] memory values) {
        values = new uint256[](length);
        for (uint256 i = 0; i < length; i++) values[i] = amount;
    }
}

contract UniswapV2AdapterTest is TestBase {
    MockStockToken private rwaA;
    MockStockToken private rwaB;
    MockStockToken private usdg;
    MockUniswapV2Router private venue;
    UniswapV2Adapter private adapter;

    function setUp() public {
        rwaA = new MockStockToken("RWA A", "A", 18);
        rwaB = new MockStockToken("RWA B", "B", 18);
        usdg = new MockStockToken("USDG", "USDG", 18);
        venue = new MockUniswapV2Router();
        adapter = new UniswapV2Adapter(address(this), address(venue));
        adapter.setCallerApproved(address(this), true);
        rwaA.mint(address(adapter), 100 ether);
        rwaA.mint(address(venue), 1_000 ether);
        rwaB.mint(address(venue), 1_000 ether);
    }

    function testRebalanceSwapMayUseUsdgAsInternalHop() public {
        address[] memory path = new address[](3);
        path[0] = address(rwaA);
        path[1] = address(usdg);
        path[2] = address(rwaB);

        uint256 received = adapter.executeSwap(
            address(rwaA), address(rwaB), 10 ether, 9 ether, abi.encode(path)
        );

        assertEq(received, 10 ether);
        assertEq(rwaB.balanceOf(address(this)), 10 ether);
        assertEq(rwaA.balanceOf(address(adapter)), 90 ether);
        assertEq(rwaA.allowance(address(adapter), address(venue)), 0);
        assertEq(usdg.balanceOf(address(adapter)), 0);
    }

    function testExactOutputEntryRefundsUnusedMaximum() public {
        usdg.mint(address(this), 20 ether);
        usdg.approve(address(adapter), 20 ether);
        address[] memory path = new address[](2);
        path[0] = address(usdg);
        path[1] = address(rwaA);

        uint256 spent = adapter.buyExactOutput(
            address(usdg), address(rwaA), 8 ether, 20 ether, abi.encode(path)
        );

        assertEq(spent, 8 ether);
        assertEq(usdg.balanceOf(address(this)), 12 ether);
        assertEq(rwaA.balanceOf(address(this)), 8 ether);
        assertEq(usdg.balanceOf(address(adapter)), 0);
        assertEq(usdg.allowance(address(adapter), address(venue)), 0);
    }

    function testInvalidEndpointsAndUnauthorizedCallerRevert() public {
        address[] memory wrongPath = new address[](2);
        wrongPath[0] = address(usdg);
        wrongPath[1] = address(rwaB);

        vm.expectRevert(UniswapV2Adapter.InvalidPath.selector);
        adapter.executeSwap(
            address(rwaA), address(rwaB), 1 ether, 1 ether, abi.encode(wrongPath)
        );

        adapter.setCallerApproved(address(this), false);
        vm.expectRevert(UniswapV2Adapter.UnauthorizedCaller.selector);
        adapter.executeSwap(
            address(rwaA), address(rwaB), 1 ether, 1 ether, abi.encode(wrongPath)
        );
    }
}
