// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed-point exponentiation used by cadence-independent expense-ratio accounting.
/// @dev Adapted from Solady's FixedPointMathLib at commit
/// c251232428b668a073293eb04c6c288b19ad5728 (MIT), originally credited to Remco Bloemen.
library FeeGrowthMath {
    int256 internal constant WAD = 1e18;

    error ExpOverflow();
    error LnWadUndefined();
    error InvalidAnnualExpenseRatio(uint256 expenseRatioBps);

    /// @notice Compound supply-growth factor that makes holder retention equal to
    ///         `(1 - annualExpenseRatio) ** elapsedYears`.
    /// @dev Because this derives growth from the complete elapsed interval, callers can make
    ///      fee checkpoints cadence-independent by retaining a fixed epoch supply.
    function expenseDilutionGrowthWad(uint16 annualExpenseRatioBps, uint256 elapsed)
        internal
        pure
        returns (uint256 growthWad)
    {
        if (annualExpenseRatioBps >= 10_000) {
            revert InvalidAnnualExpenseRatio(annualExpenseRatioBps);
        }
        uint256 retentionWad = 1e18 - Math.mulDiv(annualExpenseRatioBps, 1e18, 10_000);
        uint256 elapsedYearsWad = Math.mulDiv(elapsed, 1e18, 365 days);
        // The ratio bounds keep retention within 1e18, and elapsed originates from uint64
        // timestamps, so both values are far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 base = int256(retentionWad);
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exponent = -int256(elapsedYearsWad);
        int256 result = powWad(base, exponent);
        // expWad is non-negative throughout this supported domain.
        // forge-lint: disable-next-line(unsafe-typecast)
        growthWad = uint256(result);
    }

    /// @dev Returns `x ** y`, where both arguments and the result are WAD fixed point.
    function powWad(int256 x, int256 y) internal pure returns (int256) {
        return expWad((lnWad(x) * y) / WAD);
    }

    /// @dev Returns `e ** x`, denominated in WAD. Monotonically increasing approximation.
    function expWad(int256 x) internal pure returns (int256 r) {
        unchecked {
            if (x <= -41446531673892822313) return r;
            if (x >= 135305999368893231589) revert ExpOverflow();

            x = (x << 78) / 5 ** 18;
            int256 k = ((x << 96) / 54916777467707473351141471128 + 2 ** 95) >> 96;
            x = x - k * 54916777467707473351141471128;

            int256 y = x + 1346386616545796478920950773328;
            y = ((y * x) >> 96) + 57155421227552351082224309758442;
            int256 p = y + x - 94201549194550492254356042504812;
            p = ((p * y) >> 96) + 28719021644029726153956944680412240;
            p = p * x + (4385272521454847904659076985693276 << 96);

            int256 q = x - 2855989394907223263936484059900;
            q = ((q * x) >> 96) + 50020603652535783019961831881945;
            q = ((q * x) >> 96) - 533845033583426703283633433725380;
            q = ((q * x) >> 96) + 3604857256930695427073651918091429;
            q = ((q * x) >> 96) - 14423608567350463180887372962807573;
            q = ((q * x) >> 96) + 26449188498355588339934803723976023;

            assembly ("memory-safe") {
                r := sdiv(p, q)
            }
            assembly ("memory-safe") {
                // The rational approximation is positive in the exp domain, and `k <= 195`.
                r := shr(sub(195, k), mul(r, 3822833074963236453042738258902158003155416615667))
            }
        }
    }

    /// @dev Returns `ln(x)`, denominated in WAD. Monotonically increasing approximation.
    function lnWad(int256 x) internal pure returns (int256 r) {
        assembly ("memory-safe") {
            r := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
            r := or(r, shl(6, lt(0xffffffffffffffff, shr(r, x))))
            r := or(r, shl(5, lt(0xffffffff, shr(r, x))))
            r := or(r, shl(4, lt(0xffff, shr(r, x))))
            r := or(r, shl(3, lt(0xff, shr(r, x))))
            if iszero(sgt(x, 0)) {
                mstore(0x00, 0x1615e638) // `LnWadUndefined()`.
                revert(0x1c, 0x04)
            }
            // forgefmt: disable-next-item
            r := xor(r, byte(and(0x1f, shr(shr(r, x), 0x8421084210842108cc6318c6db6d54be)),
                0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff))

            x := shr(159, shl(r, x))

            // forgefmt: disable-next-item
            let p := sub(
                sar(96, mul(add(43456485725739037958740375743393,
                sar(96, mul(add(24828157081833163892658089445524,
                sar(96, mul(add(3273285459638523848632254066296,
                    x), x))), x))), x)), 11111509109440967052023855526967)
            p := sub(sar(96, mul(p, x)), 45023709667254063763336534515857)
            p := sub(sar(96, mul(p, x)), 14706773417378608786704636184526)
            p := sub(mul(p, x), shl(96, 795164235651350426258249787498))

            let q := add(5573035233440673466300451813936, x)
            q := add(71694874799317883764090561454958, sar(96, mul(x, q)))
            q := add(283447036172924575727196451306956, sar(96, mul(x, q)))
            q := add(401686690394027663651624208769553, sar(96, mul(x, q)))
            q := add(204048457590392012362485061816622, sar(96, mul(x, q)))
            q := add(31853899698501571402653359427138, sar(96, mul(x, q)))
            q := add(909429971244387300277376558375, sar(96, mul(x, q)))

            p := sdiv(p, q)
            p := mul(1677202110996718588342820967067443963516166, p)
            // forgefmt: disable-next-item
            p := add(mul(16597577552685614221487285958193947469193820559219878177908093499208371,
                sub(159, r)), p)
            p := add(600920179829731861736702779321621459595472258049074101567377883020018308, p)
            r := sar(174, p)
        }
    }
}
