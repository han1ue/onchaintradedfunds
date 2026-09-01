// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OTFToken } from "../src/OTFToken.sol";
import { TestBase } from "./TestBase.sol";

contract OTFTokenTest is TestBase {
    address private constant INITIAL_HOLDER = address(0xA11CE);
    address private constant SPENDER = address(0xB0B);
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;

    OTFToken private token;

    function setUp() public {
        token = new OTFToken(INITIAL_HOLDER);
    }

    function testConstructorIssuesTheMaximumSupplyExactlyOnce() public view {
        assertEq(token.MAX_SUPPLY(), INITIAL_SUPPLY);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(INITIAL_HOLDER), INITIAL_SUPPLY);
        assertEq(
            100_000_000 ether + 150_000_000 ether + 50_000_000 ether + 700_000_000 ether,
            token.MAX_SUPPLY()
        );
    }

    function testBurnReducesCallerBalanceAndTotalSupply() public {
        uint256 amount = 25 ether;

        vm.prank(INITIAL_HOLDER);
        token.burn(amount);

        assertEq(token.balanceOf(INITIAL_HOLDER), INITIAL_SUPPLY - amount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY - amount);
    }

    function testBurnFromReducesAllowanceBalanceAndTotalSupply() public {
        uint256 allowance = 40 ether;
        uint256 amount = 25 ether;

        vm.prank(INITIAL_HOLDER);
        token.approve(SPENDER, allowance);

        vm.prank(SPENDER);
        token.burnFrom(INITIAL_HOLDER, amount);

        assertEq(token.allowance(INITIAL_HOLDER, SPENDER), allowance - amount);
        assertEq(token.balanceOf(INITIAL_HOLDER), INITIAL_SUPPLY - amount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY - amount);
    }

    function testBurnFromWithoutSufficientAllowanceReverts() public {
        vm.prank(INITIAL_HOLDER);
        token.approve(SPENDER, 1 ether);

        vm.prank(SPENDER);
        vm.expectRevert();
        token.burnFrom(INITIAL_HOLDER, 2 ether);

        assertEq(token.allowance(INITIAL_HOLDER, SPENDER), 1 ether);
        assertEq(token.balanceOf(INITIAL_HOLDER), INITIAL_SUPPLY);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    function testNoPrivilegedBurnFunctionExists() public {
        (bool success,) = address(token)
            .call(abi.encodeWithSignature("burn(address,uint256)", INITIAL_HOLDER, 1 ether));

        assertFalse(success);
        assertEq(token.balanceOf(INITIAL_HOLDER), INITIAL_SUPPLY);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    function testNoPostConstructionMintFunctionExists() public {
        (bool success,) =
            address(token).call(abi.encodeWithSignature("mint(address,uint256)", SPENDER, 1 ether));

        assertFalse(success);
        assertEq(token.balanceOf(SPENDER), 0);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }
}
