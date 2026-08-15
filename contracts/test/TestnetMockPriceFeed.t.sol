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
        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        assertEq(roundId, 1_000);
        assertTrue(answer == UNIT_PRICE);
        assertLe(startedAt, 1_000);
        assertGe(startedAt, 988);
        assertEq(updatedAt, 1_000);
        assertEq(answeredInRound, roundId);
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "TSLA mock USD");
        assertEq(feed.version(), 2);
    }

    function testFeedStaysFreshAndMovesWithoutOwnerTransactions() public {
        vm.warp(1_000 + 100 days);

        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        assertEq(roundId, uint80(block.timestamp));
        assertEq(updatedAt, block.timestamp);
        assertLe(startedAt, updatedAt);
        assertGe(startedAt, updatedAt - 12);
        assertEq(answeredInRound, roundId);
        assertTrue(answer > 0);
        assertTrue(answer != UNIT_PRICE);
    }

    function testSyntheticAnswerIsStableWithinTimestamp() public view {
        (uint80 firstRound, int256 firstAnswer, uint256 firstStartedAt, uint256 firstUpdatedAt,) =
            feed.latestRoundData();
        (
            uint80 secondRound,
            int256 secondAnswer,
            uint256 secondStartedAt,
            uint256 secondUpdatedAt,
        ) = feed.latestRoundData();

        assertEq(firstRound, secondRound);
        assertTrue(firstAnswer == secondAnswer);
        assertEq(firstStartedAt, secondStartedAt);
        assertEq(firstUpdatedAt, secondUpdatedAt);
    }

    function testOwnerCanResetBaselineButIsNotRequiredForFreshness() public {
        vm.warp(2_000);
        feed.setAnswer(2_00000000);

        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertTrue(answer == 2_00000000);
        assertEq(updatedAt, 2_000);
        assertTrue(feed.baseAnswer() == 2_00000000);
        assertEq(feed.baseTimestamp(), 2_000);
    }

    function testCurrentRoundCanBeReadById() public view {
        (uint80 latestRound,,,,) = feed.latestRoundData();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            feed.getRoundData(latestRound);

        assertEq(roundId, latestRound);
        assertTrue(answer == UNIT_PRICE);
        assertEq(updatedAt, block.timestamp);
        assertEq(answeredInRound, latestRound);
    }

    function testNonOwnerCannotResetBaseline() public {
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
        feed.getRoundData(uint80(block.timestamp + 1));
    }
}
