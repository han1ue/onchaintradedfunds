// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20, IERC20Metadata } from "./interfaces/IERC20.sol";
import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IOracleRegistry } from "./interfaces/IOracleRegistry.sol";
import { IPriceFeed } from "./interfaces/IPriceFeed.sol";
import { FeeGrowthMath } from "./libraries/FeeGrowthMath.sol";
import { MathEx } from "./libraries/MathEx.sol";

interface ITargetWeightVault {
    function targetWeightBps(address asset) external view returns (uint16);
}

contract PortfolioCalculator {
    using MathEx for uint256;

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    uint256 private constant WAD = 1e18;
    uint256 private constant WEIGHT_PRECISION_SCALE = 1e12;
    uint256 private constant PRECISE_BPS = BPS * WEIGHT_PRECISION_SCALE;

    error OracleFeedMissing(address asset);
    error InvalidOraclePrice(address asset, int256 answer);
    error InvalidOracleTimestamp(address asset, uint256 updatedAt);
    error IncompleteOracleRound(address asset, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address asset, uint256 updatedAt, uint256 maxStaleness);
    error TokenDecimalsUnavailable(address token);
    error UnsupportedDecimals(address token, uint8 decimals_);
    error ZeroNav();
    error InvalidTargetWeightSum(uint256 sum);
    error InvalidFeeRate(uint16 feeBps);
    error FeeExponentOverflow(uint256 exponentWad);

    function effectiveTargetWeights(address vault, address[] calldata assets, address assetRegistry)
        external
        view
        returns (uint256[] memory weights)
    {
        uint256 storedWeightTotal;
        uint256 activeWeightTotal;
        weights = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 storedWeight = ITargetWeightVault(vault).targetWeightBps(assets[i]);
            storedWeightTotal += storedWeight;
            if (
                storedWeight != 0
                    && IAssetRegistry(assetRegistry).isApprovedAsset(assets[i])
            ) {
                weights[i] = storedWeight;
                activeWeightTotal += storedWeight;
            }
        }
        if (storedWeightTotal != BPS) revert InvalidTargetWeightSum(storedWeightTotal);
        if (activeWeightTotal == 0 || activeWeightTotal == BPS) return weights;

        uint256 assignedWeight;
        for (uint256 i = 0; i < assets.length; i++) {
            if (weights[i] == 0) continue;
            weights[i] = MathEx.mulDiv(weights[i], BPS, activeWeightTotal);
            assignedWeight += weights[i];
        }

        uint256 remainder = BPS - assignedWeight;
        for (uint256 i = 0; i < assets.length && remainder != 0; i++) {
            if (weights[i] != 0) {
                weights[i]++;
                remainder--;
            }
        }
        if (remainder != 0) revert InvalidTargetWeightSum(BPS - remainder);
    }

    function feeSharesAfterElapsed(
        uint256 supply,
        uint256 remainderWad,
        uint16 feeBps,
        uint256 elapsed
    ) external pure returns (uint256 feeShares, uint256 remainderAfterWad) {
        return _feeSharesAfterElapsed(supply, remainderWad, feeBps, elapsed);
    }

    function _feeSharesAfterElapsed(
        uint256 supply,
        uint256 remainderWad,
        uint16 feeBps,
        uint256 elapsed
    ) private pure returns (uint256 feeShares, uint256 remainderAfterWad) {
        if (supply == 0 || feeBps == 0 || elapsed == 0) return (0, remainderWad);
        if (feeBps >= BPS) revert InvalidFeeRate(feeBps);

        // `feeBps` is the exact fraction of post-fee supply owned by fee recipients after one
        // year. Exponentiation gives the composition rule G(a + b) = G(a) * G(b), so callers may
        // checkpoint at arbitrary times without changing the economic rate.
        uint256 annualGrowthWad = MathEx.mulDiv(BPS, WAD, BPS - feeBps);
        if (elapsed == YEAR) {
            uint256 denominator = BPS - feeBps;
            uint256 annualSupplyAfter = MathEx.mulDiv(supply, BPS, denominator);
            uint256 annualFractionalWad =
                (mulmod(supply, BPS, denominator) * WAD + remainderWad * BPS) / denominator;
            annualSupplyAfter += annualFractionalWad / WAD;
            remainderAfterWad = annualFractionalWad % WAD;
            return (annualSupplyAfter - supply, remainderAfterWad);
        }
        uint256 exponentWad = MathEx.mulDiv(elapsed, WAD, YEAR);
        if (exponentWad > uint256(type(int256).max)) revert FeeExponentOverflow(exponentWad);
        // The validated fee rate bounds annual growth below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 annualGrowthSigned = int256(annualGrowthWad);
        // The explicit bound above makes the exponent conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exponentSigned = int256(exponentWad);
        int256 growthSigned = FeeGrowthMath.powWad(annualGrowthSigned, exponentSigned);
        // Positive-base exponentiation is positive in the supported domain.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 growthWad = uint256(growthSigned);

        uint256 supplyAfter = MathEx.mulDiv(supply, growthWad, WAD);
        uint256 fractionalWad = mulmod(supply, growthWad, WAD);
        uint256 grownRemainderWad = MathEx.mulDiv(remainderWad, growthWad, WAD);
        fractionalWad += grownRemainderWad;
        supplyAfter += fractionalWad / WAD;
        remainderAfterWad = fractionalWad % WAD;
        feeShares = supplyAfter - supply;
    }

    function totalBasketValue(address vault, address[] calldata assets)
        external
        view
        returns (uint256 value)
    {
        for (uint256 i = 0; i < assets.length; i++) {
            uint8 tokenDecimals = _tokenDecimals(assets[i]);
            value += MathEx.mulDiv(
                IERC20(assets[i]).balanceOf(vault), 1e18, 10 ** uint256(tokenDecimals)
            );
        }
    }

    function portfolioValue(
        address vault,
        address[] calldata assets,
        address oracleRegistry,
        uint32 maxStaleness
    ) external view returns (uint256 nav) {
        (, nav) = _portfolioState(vault, assets, oracleRegistry, maxStaleness, false, BPS);
    }

    function portfolioState(
        address vault,
        address[] calldata assets,
        address oracleRegistry,
        uint32 maxStaleness
    ) external view returns (uint256[] memory weights, uint256 nav) {
        return _portfolioState(vault, assets, oracleRegistry, maxStaleness, true, BPS);
    }

    function precisePortfolioState(
        address vault,
        address[] calldata assets,
        address oracleRegistry,
        uint32 maxStaleness
    ) external view returns (uint256[] memory weights, uint256 nav) {
        return _portfolioState(vault, assets, oracleRegistry, maxStaleness, true, PRECISE_BPS);
    }

    function assetValue(
        address asset,
        uint256 rawBalance,
        address oracleRegistry,
        uint32 maxStaleness
    ) external view returns (uint256) {
        return _assetValue(asset, rawBalance, oracleRegistry, maxStaleness);
    }

    function validateAsset(address asset, address oracleRegistry, uint32 maxStaleness)
        external
        view
    {
        _tokenDecimals(asset);
        _validPrice(asset, oracleRegistry, maxStaleness);
    }

    function isWithinBands(
        address vault,
        address[] calldata assets,
        uint256[] calldata targets,
        address oracleRegistry,
        uint32 maxStaleness,
        uint16 deviationBps
    ) external view returns (bool) {
        (uint256[] memory weights,) =
            _portfolioState(vault, assets, oracleRegistry, maxStaleness, true, PRECISE_BPS);
        for (uint256 i = 0; i < assets.length; i++) {
            (uint256 lower, uint256 upper) = _preciseBand(targets[i], deviationBps);
            if (weights[i] < lower || weights[i] > upper) return false;
        }
        return true;
    }

    function breachedAssets(
        address vault,
        address[] calldata assets,
        uint256[] calldata targets,
        address oracleRegistry,
        uint32 maxStaleness,
        uint16 deviationBps
    ) external view returns (address[] memory breached) {
        (uint256[] memory weights,) =
            _portfolioState(vault, assets, oracleRegistry, maxStaleness, true, PRECISE_BPS);
        uint256 count;
        for (uint256 i = 0; i < assets.length; i++) {
            (uint256 lower, uint256 upper) = _preciseBand(targets[i], deviationBps);
            if (weights[i] < lower || weights[i] > upper) count++;
        }
        breached = new address[](count);
        uint256 cursor;
        for (uint256 i = 0; i < assets.length; i++) {
            (uint256 lower, uint256 upper) = _preciseBand(targets[i], deviationBps);
            if (weights[i] < lower || weights[i] > upper) {
                breached[cursor++] = assets[i];
            }
        }
    }

    function _portfolioState(
        address vault,
        address[] calldata assets,
        address oracleRegistry,
        uint32 maxStaleness,
        bool requireNonzero,
        uint256 weightScale
    ) private view returns (uint256[] memory weights, uint256 nav) {
        uint256[] memory values = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            values[i] = _assetValue(
                assets[i], IERC20(assets[i]).balanceOf(vault), oracleRegistry, maxStaleness
            );
            nav += values[i];
        }
        if (nav == 0) {
            if (requireNonzero) revert ZeroNav();
            return (new uint256[](assets.length), 0);
        }
        weights = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            weights[i] = MathEx.mulDiv(values[i], weightScale, nav);
        }
    }

    function _assetValue(
        address asset,
        uint256 rawBalance,
        address oracleRegistry,
        uint32 maxStaleness
    ) private view returns (uint256) {
        if (rawBalance == 0) return 0;
        (uint256 price, uint8 priceDecimals) = _validPrice(asset, oracleRegistry, maxStaleness);
        uint8 tokenDecimals = _tokenDecimals(asset);
        // Robinhood stock-token feeds already include the ERC-8056 UI multiplier.
        // Applying uiMultiplier() here would count corporate-action scaling twice.
        uint256 tokenAdjusted = MathEx.mulDiv(rawBalance, price, 10 ** uint256(tokenDecimals));
        return MathEx.mulDiv(tokenAdjusted, 1e18, 10 ** uint256(priceDecimals));
    }

    function _validPrice(address asset, address oracleRegistry, uint32 maxStaleness)
        private
        view
        returns (uint256 price, uint8 priceDecimals)
    {
        address feed = IOracleRegistry(oracleRegistry).priceFeedFor(asset);
        if (feed == address(0)) revert OracleFeedMissing(asset);
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IPriceFeed(feed).latestRoundData();
        if (answer <= 0) revert InvalidOraclePrice(asset, answer);
        // Oracle validity and freshness are necessarily measured against chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (updatedAt == 0 || updatedAt > block.timestamp) {
            revert InvalidOracleTimestamp(asset, updatedAt);
        }
        if (answeredInRound < roundId) {
            revert IncompleteOracleRound(asset, roundId, answeredInRound);
        }
        // Oracle validity and freshness are necessarily measured against chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > updatedAt + maxStaleness) {
            revert StaleOraclePrice(asset, updatedAt, maxStaleness);
        }
        priceDecimals = IPriceFeed(feed).decimals();
        if (priceDecimals > 36) revert UnsupportedDecimals(feed, priceDecimals);
        // The positive-answer check above makes this signed-to-unsigned cast lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        price = uint256(answer);
    }

    function _tokenDecimals(address token) private view returns (uint8 tokenDecimals) {
        try IERC20Metadata(token).decimals() returns (uint8 decimals_) {
            if (decimals_ > 36) revert UnsupportedDecimals(token, decimals_);
            return decimals_;
        } catch {
            revert TokenDecimalsUnavailable(token);
        }
    }

    function _preciseBand(uint256 target, uint256 deviation)
        private
        pure
        returns (uint256 lower, uint256 upper)
    {
        uint256 scaledTarget = target * WEIGHT_PRECISION_SCALE;
        uint256 scaledDeviation = deviation * WEIGHT_PRECISION_SCALE;
        lower = scaledTarget > scaledDeviation ? scaledTarget - scaledDeviation : 0;
        upper = scaledTarget + scaledDeviation > PRECISE_BPS
            ? PRECISE_BPS
            : scaledTarget + scaledDeviation;
    }
}
