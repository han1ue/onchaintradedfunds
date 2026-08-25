// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PortfolioCalculator } from "../src/PortfolioCalculator.sol";
import { RobinhoodChainlinkPriceFeed } from "../src/RobinhoodChainlinkPriceFeed.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { TestnetMockPriceFeed } from "../src/testnet/TestnetMockPriceFeed.sol";
import { TestnetMockRobinhoodPriceFeed } from "../src/testnet/TestnetMockRobinhoodPriceFeed.sol";
import { TestBase } from "./TestBase.sol";

contract TestnetMockRobinhoodPriceFeedTest is TestBase {
    int256 private constant UNIT_PRICE = 100_00000000;

    PortfolioCalculator private calculator;
    MockReentrantToken private officialTestnetTokenShape;
    MockStockToken private tokenWithPauseStatus;
    TestnetMockPriceFeed private standardFeed;
    TestnetMockRobinhoodPriceFeed private robinhoodFeed;
    RobinhoodChainlinkPriceFeed private productionFeed;

    function setUp() public {
        vm.warp(1_000);
        calculator = new PortfolioCalculator();
        officialTestnetTokenShape = new MockReentrantToken("Testnet stock", "STOCK", 18);
        tokenWithPauseStatus = new MockStockToken("Production stock", "STOCK", 18);
        standardFeed = new TestnetMockPriceFeed(address(this), 8, UNIT_PRICE, "Standard mock USD");
        robinhoodFeed = new TestnetMockRobinhoodPriceFeed(
            address(this), 8, UNIT_PRICE, "Robinhood stock mock USD"
        );
        productionFeed =
            new RobinhoodChainlinkPriceFeed(address(tokenWithPauseStatus), standardFeed);
    }

    function testDedicatedFeedIsChainlinkCompatibleAndIdentifiable() public view {
        assertTrue(robinhoodFeed.isRobinhoodPriceFeed());
        assertFalse(robinhoodFeed.oraclePaused());
        assertEq(robinhoodFeed.description(), "Robinhood stock mock USD");
        (, int256 answer,,, uint80 answeredInRound) = robinhoodFeed.latestRoundData();
        assertTrue(answer == UNIT_PRICE);
        assertEq(answeredInRound, uint80(block.timestamp));
    }

    function testDedicatedMockSuppliesPauseStatusWithoutCallingToken() public view {
        (uint256 price, uint8 priceDecimals) = calculator.validatePriceFeed(
            address(officialTestnetTokenShape), robinhoodFeed, 1 hours, true
        );

        assertEq(price, uint256(UNIT_PRICE));
        assertEq(priceDecimals, 8);
    }

    function testStandardFeedCannotStandInForRobinhoodOracle() public {
        vm.expectPartialRevert(PortfolioCalculator.OraclePauseStatusUnavailable.selector);
        calculator.validatePriceFeed(
            address(officialTestnetTokenShape), standardFeed, 1 hours, true
        );
    }

    function testProductionOracleDelegatesPriceAndTokenPauseStatus() public {
        assertTrue(productionFeed.isRobinhoodPriceFeed());
        assertFalse(productionFeed.oraclePaused());
        (uint256 price, uint8 priceDecimals) = calculator.validatePriceFeed(
            address(tokenWithPauseStatus), productionFeed, 1 hours, true
        );
        assertEq(price, uint256(UNIT_PRICE));
        assertEq(priceDecimals, 8);

        tokenWithPauseStatus.setOraclePaused(true);
        vm.expectPartialRevert(PortfolioCalculator.OraclePaused.selector);
        calculator.validatePriceFeed(address(tokenWithPauseStatus), productionFeed, 1 hours, true);
    }

    function testProductionOracleRejectsTokenWithoutPauseStatus() public {
        vm.expectPartialRevert(RobinhoodChainlinkPriceFeed.OraclePauseStatusUnavailable.selector);
        new RobinhoodChainlinkPriceFeed(address(officialTestnetTokenShape), standardFeed);
    }
}



