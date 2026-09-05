// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MainnetRehearsalBase } from "./MainnetRehearsalBase.sol";
import { TeamMarketCapVesting } from "../../src/TeamMarketCapVesting.sol";
import {
    IUniswapV4StateView,
    IUniswapUniversalRouter,
    IPermit2AllowanceTransfer,
    UniswapV4PathKey,
    UniswapV4ExactInputParams
} from "../../src/interfaces/IUniswapV4.sol";

contract MainnetVestingTest is MainnetRehearsalBase {
    function testLiveOracleAndCanonicalPoolPriceAtLaunchAndGraduation() public {
        vm.prank(deployer);
        launch.initializeLaunch();
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
        assertLe(updatedAt, block.timestamp);
        (uint256 normalized, uint256 observedUpdate, uint256 age) = vesting.oracleStatus();
        // The live answer was checked positive above.
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(normalized, uint256(answer) * 1e10);
        assertEq(observedUpdate, updatedAt);
        assertEq(age, block.timestamp - updatedAt);
        assertLe(age, oracleMaxAge);
        assertEq(oracleMaxAge, vm.parseJsonUint(rehearsal, ".oracle.heartbeatSeconds") + 1 hours);
        _assertFdv(normalized);
        vm.prank(investor);
        launchRouter.buyOtfWithEth{ value: 20 ether }(1, investor, block.timestamp);
        _assertFdv(normalized);
    }

    function testCheckpointAndClaimWithLiveOracleAfterMarketPurchases() public {
        _graduate();
        _buyOnGraduatedMarket(20 ether);
        uint256 expected = vesting.liveFdvUsdWad() / vesting.FDV_MILESTONE_USD_WAD();
        if (expected > vesting.MILESTONE_COUNT()) expected = vesting.MILESTONE_COUNT();
        expected *= vesting.TRANCHE_SIZE();
        assertGt(expected, 0, "Market purchase did not reach a vesting milestone");
        vm.prank(beneficiary);
        assertEq(vesting.checkpoint(), expected);
        uint256 before = otf.balanceOf(beneficiary);
        vm.prank(beneficiary);
        assertEq(vesting.claim(), expected);
        assertEq(otf.balanceOf(beneficiary) - before, expected);
        assertEq(vesting.claimedAmount(), expected);
        assertEq(vesting.claimable(), 0);
        assertEq(otf.balanceOf(address(vesting)) + vesting.claimedAmount(), 100_000_000 ether);
        vm.prank(beneficiary);
        assertEq(vesting.checkpoint(), expected);
        assertEq(vesting.claimable(), 0);
    }

    function testOracleFreshnessBoundaryOnActualFeed() public {
        _graduate();
        (, uint256 updatedAt,) = vesting.oracleStatus();
        vm.warp(updatedAt + oracleMaxAge);
        vesting.oracleStatus();
        vm.prank(beneficiary);
        vesting.checkpoint();
        uint256 unlocked = vesting.unlockedAmount();
        vm.warp(updatedAt + oracleMaxAge + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                TeamMarketCapVesting.StaleOracle.selector, updatedAt, oracleMaxAge
            )
        );
        vm.prank(beneficiary);
        vesting.checkpoint();
        assertEq(vesting.unlockedAmount(), unlocked);
    }

    function _assertFdv(uint256 ethUsd) private view {
        (uint160 sqrtPrice,,,) = IUniswapV4StateView(stateView).getSlot0(launch.poolId());
        uint256 price = launch.otfIsCurrency0()
            ? Math.mulDiv(uint256(sqrtPrice), uint256(sqrtPrice) * 1e18, 1 << 192)
            : Math.mulDiv(1 << 96, (1 << 96) * 1e18, sqrtPrice) / sqrtPrice;
        assertEq(vesting.currentOtfPriceWethWad(), price);
        assertEq(
            vesting.liveFdvUsdWad(),
            Math.mulDiv(Math.mulDiv(price, otf.totalSupply(), 1e18), ethUsd, 1e18)
        );
    }

    // An ordinary funded purchase after graduation. No oracle or pool state is overwritten.
    function _buyOnGraduatedMarket(uint128 amount) private {
        UniswapV4PathKey[] memory path = new UniswapV4PathKey[](1);
        path[0] = UniswapV4PathKey(address(otf), 0, 1, address(launch), bytes(""));
        bytes[] memory actions = new bytes[](3);
        actions[0] =
            abi.encode(UniswapV4ExactInputParams(address(weth), path, new uint256[](0), amount, 1));
        actions[1] = abi.encode(address(weth), uint256(amount));
        actions[2] = abi.encode(address(otf), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"070c0f", actions);
        uint256 before = otf.balanceOf(investor);
        vm.startPrank(investor);
        weth.deposit{ value: amount }();
        weth.approve(permit2, amount);
        IPermit2AllowanceTransfer(permit2)
            .approve(address(weth), universalRouter, amount, uint48(block.timestamp + 1));
        IUniswapUniversalRouter(universalRouter).execute(hex"10", inputs, block.timestamp);
        IPermit2AllowanceTransfer(permit2).approve(address(weth), universalRouter, 0, 0);
        weth.approve(permit2, 0);
        vm.stopPrank();
        assertGt(otf.balanceOf(investor), before);
    }
}
