// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FakeETHUSDOracle } from "../src/mocks/FakeETHUSDOracle.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { TeamMarketCapVesting } from "../src/TeamMarketCapVesting.sol";
import { MockUniswapV4PoolManager, MockUniswapV4StateView } from "./mocks/MockUniswapV4.sol";
import { TestBase, Vm } from "./TestBase.sol";

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
    address private constant NEXT_BENEFICIARY = address(0xCAFE);
    address private constant REPLACEMENT_BENEFICIARY = address(0xD00D);
    address private constant STRANGER = address(0xBAD);

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

    function testInitialBeneficiaryIsConfiguredAddress() public view {
        assertEq(vesting.beneficiary(), BENEFICIARY);
        assertEq(vesting.pendingBeneficiary(), address(0));
    }

    function testOnlyCurrentBeneficiaryCanCheckpoint() public {
        _setDirectFdv(1_000_000 ether);

        vm.prank(STRANGER);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.checkpoint();

        vm.prank(BENEFICIARY);
        assertEq(vesting.checkpoint(), 10_000_000 ether);
    }

    function testCheckpointAuthorityFollowsBeneficiarySuccession() public {
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(NEXT_BENEFICIARY);
        vesting.acceptBeneficiaryTransfer();
        _setDirectFdv(1_000_000 ether);

        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.checkpoint();

        vm.prank(NEXT_BENEFICIARY);
        assertEq(vesting.checkpoint(), 10_000_000 ether);
    }

    function testUnlocksBelowAtAndAboveEveryMillionAndNeverRelocks() public {
        for (uint256 milestone = 1; milestone <= 10; milestone++) {
            _setDirectFdv(milestone * 1_000_000 ether - 1 ether);
            _checkpointAsBeneficiary();
            assertEq(vesting.unlockedAmount(), (milestone - 1) * 10_000_000 ether);

            _setDirectFdv(milestone * 1_000_000 ether);
            _checkpointAsBeneficiary();
            assertEq(vesting.unlockedAmount(), milestone * 10_000_000 ether);

            _setDirectFdv(milestone * 1_000_000 ether + 1 ether);
            _checkpointAsBeneficiary();
            assertEq(vesting.unlockedAmount(), milestone * 10_000_000 ether);
        }

        _setDirectFdv(500_000 ether);
        _checkpointAsBeneficiary();
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
        _checkpointAsBeneficiary();
        uint256 beforeBurn = vesting.liveFdvUsdWad();
        vm.prank(HOLDER);
        token.burn(500_000_000 ether);
        uint256 afterBurn = vesting.liveFdvUsdWad();
        assertApproxEqAbs(afterBurn * 2, beforeBurn, 2);
        _checkpointAsBeneficiary();
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
        _checkpointAsBeneficiary();
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

    function testOnlyCurrentBeneficiaryCanNominateCancelAndNominationRejectsZero() public {
        vm.prank(STRANGER);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);

        vm.prank(BENEFICIARY);
        vm.expectRevert(TeamMarketCapVesting.ZeroAddress.selector);
        vesting.initiateBeneficiaryTransfer(address(0));

        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(STRANGER);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.cancelBeneficiaryTransfer();
    }

    function testCurrentBeneficiaryRetainsClaimAuthorityWhileTransferIsPending() public {
        _setDirectFdv(1_000_000 ether);
        _checkpointAsBeneficiary();
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);

        vm.prank(NEXT_BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.claim();
        vm.prank(BENEFICIARY);
        assertEq(vesting.claim(), 10_000_000 ether);
    }

    function testOnlyPendingBeneficiaryCanAccept() public {
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);

        vm.prank(STRANGER);
        vm.expectPartialRevert(TeamMarketCapVesting.NotPendingBeneficiary.selector);
        vesting.acceptBeneficiaryTransfer();
        vm.prank(NEXT_BENEFICIARY);
        vesting.acceptBeneficiaryTransfer();
        assertEq(vesting.beneficiary(), NEXT_BENEFICIARY);
        assertEq(vesting.pendingBeneficiary(), address(0));
    }

    function testCancellationPreventsAcceptance() public {
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(BENEFICIARY);
        vesting.cancelBeneficiaryTransfer();

        assertEq(vesting.pendingBeneficiary(), address(0));
        vm.prank(NEXT_BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotPendingBeneficiary.selector);
        vesting.acceptBeneficiaryTransfer();
    }

    function testBeneficiaryTransferEmitsLifecycleEvents() public {
        vm.recordLogs();
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(BENEFICIARY);
        vesting.cancelBeneficiaryTransfer();
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(NEXT_BENEFICIARY);
        vesting.acceptBeneficiaryTransfer();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 4);
        assertEq(logs[0].topics[0], keccak256("BeneficiaryTransferInitiated(address,address)"));
        assertEq(logs[1].topics[0], keccak256("BeneficiaryTransferCancelled(address,address)"));
        assertEq(logs[3].topics[0], keccak256("BeneficiaryTransferAccepted(address,address)"));
        assertEq(logs[3].emitter, address(vesting));
        assertEq(logs[3].topics[1], bytes32(uint256(uint160(BENEFICIARY))));
        assertEq(logs[3].topics[2], bytes32(uint256(uint160(NEXT_BENEFICIARY))));
    }

    function testReplacingNominationInvalidatesPreviousPendingBeneficiary() public {
        vm.startPrank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(REPLACEMENT_BENEFICIARY);
        vm.stopPrank();

        assertEq(vesting.pendingBeneficiary(), REPLACEMENT_BENEFICIARY);
        vm.prank(NEXT_BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotPendingBeneficiary.selector);
        vesting.acceptBeneficiaryTransfer();
    }

    function testAcceptedTransferChangesAuthorityWithoutChangingAccounting() public {
        _setDirectFdv(1_000_000 ether);
        _checkpointAsBeneficiary();
        vm.prank(BENEFICIARY);
        assertEq(vesting.claim(), 10_000_000 ether);

        _setDirectFdv(2_000_000 ether);
        _checkpointAsBeneficiary();
        uint256 unlockedBefore = vesting.unlockedAmount();
        uint256 claimedBefore = vesting.claimedAmount();
        vm.prank(BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(NEXT_BENEFICIARY);
        vm.prank(NEXT_BENEFICIARY);
        vesting.acceptBeneficiaryTransfer();

        assertEq(vesting.unlockedAmount(), unlockedBefore);
        assertEq(vesting.claimedAmount(), claimedBefore);
        assertEq(vesting.claimable(), unlockedBefore - claimedBefore);
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.claim();
        vm.prank(BENEFICIARY);
        vm.expectPartialRevert(TeamMarketCapVesting.NotBeneficiary.selector);
        vesting.initiateBeneficiaryTransfer(REPLACEMENT_BENEFICIARY);
        vm.prank(NEXT_BENEFICIARY);
        assertEq(vesting.claim(), 10_000_000 ether);
        vm.prank(NEXT_BENEFICIARY);
        vesting.initiateBeneficiaryTransfer(REPLACEMENT_BENEFICIARY);
        assertEq(vesting.pendingBeneficiary(), REPLACEMENT_BENEFICIARY);
    }

    function _setDirectFdv(uint256 fdvUsdWad) private {
        uint256 priceWad = _priceForFdv(fdvUsdWad);
        uint256 ratio = Math.mulDiv(Q192, priceWad, 1e18, Math.Rounding.Ceil);
        uint256 sqrtRatio = Math.sqrt(ratio);
        if (sqrtRatio * sqrtRatio < ratio) sqrtRatio++;
        stateView.setPool(poolId, uint160(sqrtRatio));
    }

    function _checkpointAsBeneficiary() private returns (uint256 cumulativeUnlocked) {
        vm.prank(BENEFICIARY);
        return vesting.checkpoint();
    }

    function _priceForFdv(uint256 fdvUsdWad) private view returns (uint256) {
        return Math.mulDiv(fdvUsdWad, 1e36, token.totalSupply() * 2_000 ether, Math.Rounding.Ceil);
    }
}
