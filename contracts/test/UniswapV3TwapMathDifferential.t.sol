// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { UniswapV3TwapMath } from "../src/libraries/UniswapV3TwapMath.sol";
import { TestBase } from "./TestBase.sol";

/// @dev Test-only snapshot of Uniswap v3-core v1.0.1 TickMath.getSqrtRatioAtTick.
/// The casts are adapted to Solidity 0.8.x; constants and rounding are unchanged.
library CanonicalUniswapV3TickMathReference {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = uint256(tick < 0 ? -int256(tick) : int256(tick));
        require(absTick <= uint256(int256(MAX_TICK)), "T");
        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;
        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }

    function getQuoteAtTick(int24 tick, uint128 baseAmount, address baseToken, address quoteToken)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        uint160 sqrtRatioX96 = getSqrtRatioAtTick(tick);
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX192, baseAmount, 1 << 192)
                : Math.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = Math.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX128, baseAmount, 1 << 128)
                : Math.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }
}

contract UniswapV3TwapMathHarness {
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return UniswapV3TwapMath.sqrtRatioAtTick(tick);
    }

    function quoteAtTick(int24 tick, uint128 amount, address baseToken, address quoteToken)
        external
        pure
        returns (uint256)
    {
        return UniswapV3TwapMath.quoteAtTick(tick, amount, baseToken, quoteToken);
    }
}

contract UniswapV3TwapMathDifferentialTest is TestBase {
    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = 887272;
    uint256 private constant TICK_DOMAIN_SIZE = 1_774_544;
    address private constant TOKEN_0 = address(1);
    address private constant TOKEN_1 = address(2);

    UniswapV3TwapMathHarness private harness;

    function setUp() public {
        harness = new UniswapV3TwapMathHarness();
    }

    function testCanonicalBoundaryVectors() public view {
        assertEq(uint256(harness.sqrtRatioAtTick(MIN_TICK)), 4_295_128_739);
        assertEq(
            uint256(harness.sqrtRatioAtTick(MAX_TICK)),
            1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
        );
        assertEq(uint256(harness.sqrtRatioAtTick(0)), 1 << 96);
    }

    function testFuzzSqrtRatioMatchesCanonicalAcrossFullTickDomain(uint32 rawTick) public view {
        int24 tick = _boundTick(rawTick);
        assertEq(
            uint256(harness.sqrtRatioAtTick(tick)),
            uint256(CanonicalUniswapV3TickMathReference.getSqrtRatioAtTick(tick))
        );
    }

    function testFuzzQuoteMatchesCanonicalOracleLibraryFormula(
        uint32 rawTick,
        uint128 baseAmount,
        bool baseIsToken0
    ) public view {
        int24 tick = _boundTick(rawTick);
        address baseToken = baseIsToken0 ? TOKEN_0 : TOKEN_1;
        address quoteToken = baseIsToken0 ? TOKEN_1 : TOKEN_0;
        assertEq(
            harness.quoteAtTick(tick, baseAmount, baseToken, quoteToken),
            CanonicalUniswapV3TickMathReference.getQuoteAtTick(
                tick, baseAmount, baseToken, quoteToken
            )
        );
    }

    function testFuzzSqrtRatioIsStrictlyIncreasing(uint32 rawTick) public view {
        int24 tick = _boundTick(rawTick);
        if (tick == MAX_TICK) return;
        assertGt(uint256(harness.sqrtRatioAtTick(tick + 1)), uint256(harness.sqrtRatioAtTick(tick)));
    }

    function testRejectsTicksOutsideCanonicalDomain() public {
        vm.expectPartialRevert(UniswapV3TwapMath.InvalidTick.selector);
        harness.sqrtRatioAtTick(MIN_TICK - 1);
        vm.expectPartialRevert(UniswapV3TwapMath.InvalidTick.selector);
        harness.sqrtRatioAtTick(MAX_TICK + 1);
    }

    function _boundTick(uint32 rawTick) private pure returns (int24) {
        uint256 offset = uint256(rawTick) % (TICK_DOMAIN_SIZE + 1);
        return int24(int256(MIN_TICK) + int256(offset));
    }
}
