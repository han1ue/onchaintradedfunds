// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FakeETHUSDOracle } from "../src/mocks/FakeETHUSDOracle.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { TeamMarketCapVesting } from "../src/TeamMarketCapVesting.sol";
import { MockUniswapV4PoolManager, MockUniswapV4StateView } from "./mocks/MockUniswapV4.sol";
import { TestBase } from "./TestBase.sol";

contract MockETHUSDOracle {
    uint8 public immutable decimals = 8;
    int256 public answer = 2_000e8;
    uint256 public updatedAt;

    constructor() {
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockLaunchPriceSource {
    address public immutable otf;
    address public immutable stateView;
    bytes32 public immutable poolId;
    bool public immutable otfIsCurrency0;

    constructor(address otf_, address stateView_, bytes32 poolId_, bool otfIsCurrency0_) {
        otf = otf_;
        stateView = stateView_;
        poolId = poolId_;
        otfIsCurrency0 = otfIsCurrency0_;
    }
}

contract TeamMarketCapVestingTest is TestBase {
    uint256 private constant Q192 = 1 << 192;
    address private constant HOLDER = address(0xA11CE);
    address private constant BENEFICIARY = address(0xBEEF);

    OTFToken private token;
    MockUniswapV4StateView private stateView;
    MockETHUSDOracle private oracle;
    TeamMarketCapVesting private vesting;
    bytes32 private poolId;

    function setUp() public {
        token = new OTFToken(HOLDER);
        MockUniswapV4PoolManager poolManager = new MockUniswapV4PoolManager();
        stateView = new MockUniswapV4StateView(address(poolManager));
        oracle = new MockETHUSDOracle();
        poolId = keccak256("OTF_WETH");
        MockLaunchPriceSource launch =
            new MockLaunchPriceSource(address(token), address(stateView), poolId, true);
        vesting = new TeamMarketCapVesting(address(launch), address(oracle), 1 days, BENEFICIARY);
        vm.prank(HOLDER);
        token.transfer(address(vesting), 100_000_000 ether);
    }

    function testFakeTestnetOracleIsExactlyTwoThousandDollars() public {
        FakeETHUSDOracle fake = new FakeETHUSDOracle();
        (, int256 answer,,,) = fake.latestRoundData();
        assertEq(uint256(answer), 2_000e8);
        assertEq(uint256(fake.decimals()), 8);
        assertEq(fake.description(), "ETH / USD");
        assertEq(fake.version(), 1);
        (uint80 roundId, int256 roundAnswer,, uint256 updatedAt, uint80 answeredInRound) =
            fake.getRoundData(7);
        assertEq(uint256(roundId), 7);
        assertEq(uint256(roundAnswer), 2_000e8);
        assertEq(updatedAt, block.timestamp);
        assertEq(uint256(answeredInRound), 7);
    }

    function testUnlocksBelowAtAndAboveEveryMillionAndNeverRelocks() public {
        for (uint256 milestone = 1; milestone <= 10; milestone++) {
            _setDirectFdv(milestone * 1_000_000 ether - 1 ether);
            vesting.checkpoint();
            assertEq(vesting.unlockedAmount(), (milestone - 1) * 10_000_000 ether);

            _setDirectFdv(milestone * 1_000_000 ether);
            vesting.checkpoint();
            assertEq(vesting.unlockedAmount(), milestone * 10_000_000 ether);

            _setDirectFdv(milestone * 1_000_000 ether + 1 ether);
            vesting.checkpoint();
            assertEq(vesting.unlockedAmount(), milestone * 10_000_000 ether);
        }

        _setDirectFdv(500_000 ether);
        vesting.checkpoint();
        assertEq(vesting.unlockedAmount(), 100_000_000 ether);
    }

    function testSpotPriceHandlesBothCurrencyOrderings() public {
        _setDirectFdv(3_000_000 ether);
        uint256 directFdv = vesting.liveFdvUsdWad();

        bytes32 inversePoolId = keccak256("WETH_OTF");
        MockLaunchPriceSource inverseLaunch =
            new MockLaunchPriceSource(address(token), address(stateView), inversePoolId, false);
        TeamMarketCapVesting inverse =
            new TeamMarketCapVesting(address(inverseLaunch), address(oracle), 1 days, BENEFICIARY);
        uint256 targetPriceWad = _priceForFdv(3_000_000 ether);
        uint256 ratio = Math.mulDiv(Q192, 1e18, targetPriceWad, Math.Rounding.Ceil);
        uint256 sqrtRatio = Math.sqrt(ratio);
        stateView.setPool(inversePoolId, uint160(sqrtRatio));
        assertApproxEqAbs(inverse.liveFdvUsdWad(), directFdv, 1e12);
    }

    function testBurnsReduceLiveFdvWithoutRelocking() public {
        _setDirectFdv(2_000_000 ether);
        vesting.checkpoint();
        uint256 beforeBurn = vesting.liveFdvUsdWad();
        vm.prank(HOLDER);
        token.burn(500_000_000 ether);
        uint256 afterBurn = vesting.liveFdvUsdWad();
        assertApproxEqAbs(afterBurn * 2, beforeBurn, 2);
        vesting.checkpoint();
        assertEq(vesting.unlockedAmount(), 20_000_000 ether);
    }

    function testOracleRejectsZeroNegativeFutureAndStaleAnswers() public {
        _setDirectFdv(1_000_000 ether);
        oracle.set(0, block.timestamp);
        vm.expectPartialRevert(TeamMarketCapVesting.InvalidOracleAnswer.selector);
        vesting.liveFdvUsdWad();
        oracle.set(-1, block.timestamp);
        vm.expectPartialRevert(TeamMarketCapVesting.InvalidOracleAnswer.selector);
        vesting.liveFdvUsdWad();
        oracle.set(2_000e8, block.timestamp + 1);
        vm.expectPartialRevert(TeamMarketCapVesting.InvalidOracleTimestamp.selector);
        vesting.liveFdvUsdWad();
        vm.warp(block.timestamp + 2 days);
        oracle.set(2_000e8, block.timestamp - 2 days);
        vm.expectPartialRevert(TeamMarketCapVesting.StaleOracle.selector);
        vesting.liveFdvUsdWad();
    }

    function testOnlyBeneficiaryClaimsAndCannotExceedUnlocked() public {
        _setDirectFdv(1_000_000 ether);
        vesting.checkpoint();
        vm.prank(address(0xBAD));
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.claim();
        vm.prank(BENEFICIARY);
        assertEq(vesting.claim(), 10_000_000 ether);
        assertEq(token.balanceOf(BENEFICIARY), 10_000_000 ether);
        vm.prank(BENEFICIARY);
        vm.expectRevert(TeamMarketCapVesting.NothingToClaim.selector);
        vesting.claim();
    }

    function _setDirectFdv(uint256 fdvUsdWad) private {
        uint256 priceWad = _priceForFdv(fdvUsdWad);
        uint256 ratio = Math.mulDiv(Q192, priceWad, 1e18, Math.Rounding.Ceil);
        uint256 sqrtRatio = Math.sqrt(ratio);
        if (sqrtRatio * sqrtRatio < ratio) sqrtRatio++;
        stateView.setPool(poolId, uint160(sqrtRatio));
    }

    function _priceForFdv(uint256 fdvUsdWad) private view returns (uint256) {
        return Math.mulDiv(fdvUsdWad, 1e36, token.totalSupply() * 2_000 ether, Math.Rounding.Ceil);
    }
}
