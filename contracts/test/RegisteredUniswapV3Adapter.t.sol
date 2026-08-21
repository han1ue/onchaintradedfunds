// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { RegisteredUniswapV3Adapter } from "../src/RegisteredUniswapV3Adapter.sol";
import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockUniswapV3Router } from "../src/mocks/MockUniswapV3Router.sol";
import { TestBase } from "./TestBase.sol";

contract RegisteredUniswapV3AdapterTest is TestBase {
    MockStockToken private tokenIn;
    MockStockToken private intermediate;
    MockStockToken private tokenOut;
    MockUniswapV3Router private router;
    RegisteredUniswapV3Adapter private adapter;

    function setUp() public {
        tokenIn = new MockStockToken("Input", "IN", 18);
        intermediate = new MockStockToken("Intermediate", "MID", 18);
        tokenOut = new MockStockToken("Output", "OUT", 18);
        router = new MockUniswapV3Router();
        adapter = new RegisteredUniswapV3Adapter(address(this), address(router));
        adapter.setCallerApproved(address(this), true);
        tokenIn.mint(address(adapter), 10 ether);
        tokenOut.mint(address(router), 10 ether);
    }

    function testExecutesDirectAndArbitraryIntermediatePaths() public {
        bytes memory direct =
            abi.encodePacked(address(tokenIn), bytes3(uint24(500)), address(tokenOut));
        assertEq(
            adapter.executeSwap(address(tokenIn), address(tokenOut), 1 ether, 1 ether, direct),
            1 ether
        );

        bytes memory multiHop = abi.encodePacked(
            address(tokenIn),
            bytes3(uint24(100)),
            address(intermediate),
            bytes3(uint24(3_000)),
            address(tokenOut)
        );
        assertEq(
            adapter.executeSwap(address(tokenIn), address(tokenOut), 1 ether, 1 ether, multiHop),
            1 ether
        );
        assertEq(keccak256(router.lastPath()), keccak256(multiHop));
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function testRejectsMalformedMismatchedAndZeroFeePaths() public {
        vm.expectPartialRevert(RegisteredUniswapV3Adapter.InvalidPath.selector);
        adapter.executeSwap(
            address(tokenIn),
            address(tokenOut),
            1 ether,
            1 ether,
            abi.encodePacked(address(intermediate), bytes3(uint24(500)), address(tokenOut))
        );

        vm.expectPartialRevert(RegisteredUniswapV3Adapter.InvalidPath.selector);
        adapter.executeSwap(
            address(tokenIn),
            address(tokenOut),
            1 ether,
            1 ether,
            abi.encodePacked(address(tokenIn), bytes3(uint24(0)), address(tokenOut))
        );
    }

    function testRejectsUnauthorizedCaller() public {
        adapter.setCallerApproved(address(this), false);
        vm.expectPartialRevert(RegisteredUniswapV3Adapter.UnauthorizedCaller.selector);
        adapter.executeSwap(
            address(tokenIn),
            address(tokenOut),
            1 ether,
            1 ether,
            abi.encodePacked(address(tokenIn), bytes3(uint24(500)), address(tokenOut))
        );
    }

    function testSlippageAndReportedOutputMismatchRevertAtomically() public {
        bytes memory path =
            abi.encodePacked(address(tokenIn), bytes3(uint24(500)), address(tokenOut));
        vm.expectRevert(bytes("SLIPPAGE"));
        adapter.executeSwap(address(tokenIn), address(tokenOut), 1 ether, 2 ether, path);

        router.setReportedOutputBonus(1);
        vm.expectPartialRevert(RegisteredUniswapV3Adapter.OutputMismatch.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 1 ether, 1 ether, path);
        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
        assertEq(tokenOut.balanceOf(address(this)), 0);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }
}
