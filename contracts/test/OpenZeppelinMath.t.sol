// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { TestBase } from "./TestBase.sol";

contract OpenZeppelinMathHarness {
    function floor(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return Math.mulDiv(x, y, denominator);
    }

    function ceil(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return Math.mulDiv(x, y, denominator, Math.Rounding.Ceil);
    }
}

contract OpenZeppelinMathTest is TestBase {
    OpenZeppelinMathHarness private harness;

    function setUp() public {
        harness = new OpenZeppelinMathHarness();
    }

    function testCeilingRevertsWhenMathematicalResultExceedsUint256() public {
        uint256 supply = 1e18;
        uint256 reserve = 2e18 + 3;
        uint256 shares =
            57_896_044_618_658_097_624_941_425_576_356_807_489_222_853_968_285_070_785_894_511_051_528_958_641_126;

        assertEq(harness.floor(shares, reserve, supply), type(uint256).max);
        assertGt(mulmod(shares, reserve, supply), 0);

        vm.expectRevert();
        harness.ceil(shares, reserve, supply);
    }

    function testCeilingCanReturnUint256MaxWhenNoRoundingIsRequired() public view {
        assertEq(harness.ceil(type(uint256).max, 1, 1), type(uint256).max);
    }
}



