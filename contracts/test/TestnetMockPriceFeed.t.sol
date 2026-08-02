// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TestnetMockPriceFeed } from "../src/mocks/TestnetMockPriceFeed.sol";
import { TestBase } from "./TestBase.sol";

contract TestnetMockPriceFeedTest is TestBase {
    address private constant ATTACKER = address(0xBEEF);
    int256 private constant UNIT_PRICE = 1_00000000;

    TestnetMockPriceFeed private feed;

    function setUp() public {
        vm.warp(1_000);
        feed = new TestnetMockPriceFeed(address(this), 8, UNIT_PRICE, "TSLA mock USD");
    }

    function testInitialRoundMatchesAggregatorV3Shape() public view {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        = feed.latestRoundData();

        assertEq(roundId, 1);
        assertTrue(answer == UNIT_PRICE);
        assertEq(startedAt, 1_000);
        assertEq(updatedAt, 1_000);
        assertEq(answeredInRound, 1);
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "TSLA mock USD");
        assertEq(feed.version(), 1);
    }

    function testOwnerCanPublishNextRound() public {
        vm.warp(2_000);
        feed.setAnswer(2_00000000);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            feed.getRoundData(2);
        assertEq(roundId, 2);
        assertTrue(answer == 2_00000000);
        assertEq(updatedAt, 2_000);
        assertEq(answeredInRound, 2);
    }

    function testNonOwnerCannotPublish() public {
        vm.prank(ATTACKER);
        vm.expectRevert(TestnetMockPriceFeed.NotOwner.selector);
        feed.setAnswer(2_00000000);
    }

    function testRejectsInvalidConfigurationAndAnswers() public {
        vm.expectRevert(TestnetMockPriceFeed.ZeroAddress.selector);
        new TestnetMockPriceFeed(address(0), 8, UNIT_PRICE, "invalid");

        vm.expectPartialRevert(TestnetMockPriceFeed.InvalidDecimals.selector);
        new TestnetMockPriceFeed(address(this), 19, UNIT_PRICE, "invalid");

        vm.expectPartialRevert(TestnetMockPriceFeed.InvalidAnswer.selector);
        new TestnetMockPriceFeed(address(this), 8, 0, "invalid");

        vm.expectPartialRevert(TestnetMockPriceFeed.InvalidAnswer.selector);
        feed.setAnswer(-1);
    }

    function testRejectsUnknownRound() public {
        vm.expectPartialRevert(TestnetMockPriceFeed.RoundUnavailable.selector);
        feed.getRoundData(2);
    }
}
