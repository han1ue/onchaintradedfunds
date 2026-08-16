// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { UniswapV3TwapMath } from "./libraries/UniswapV3TwapMath.sol";

interface IUniswapV3OraclePool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        );
}

/// @notice Chain-native USDG price feed for an 18-decimal asset quoted in WETH or USDG.
/// @dev WETH-quoted assets compose their mean tick with WETH/USDG; USDG pairs are direct.
contract UniswapV3RoutePriceFeed is AggregatorV3Interface {
    uint32 public constant TWAP_WINDOW = 1 hours;

    error ZeroAddress();
    error InvalidPoolPair(address pool);
    error InvalidTwapPrice();

    address public immutable asset;
    address public immutable weth;
    address public immutable usdg;
    address public immutable quoteToken;
    IUniswapV3OraclePool public immutable assetQuotePool;
    IUniswapV3OraclePool public immutable wethUsdgPool;

    constructor(
        address asset_,
        address weth_,
        address usdg_,
        IUniswapV3OraclePool assetWethPool_,
        IUniswapV3OraclePool wethUsdgPool_
    ) {
        if (
            asset_ == address(0) || weth_ == address(0) || usdg_ == address(0)
                || address(assetWethPool_) == address(0) || address(wethUsdgPool_) == address(0)
        ) revert ZeroAddress();
        bool wethQuoted = _isPair(assetWethPool_, asset_, weth_);
        bool usdgQuoted = _isPair(assetWethPool_, asset_, usdg_);
        if (!wethQuoted && !usdgQuoted) revert InvalidPoolPair(address(assetWethPool_));
        _requirePair(wethUsdgPool_, weth_, usdg_);
        asset = asset_;
        weth = weth_;
        usdg = usdg_;
        quoteToken = wethQuoted ? weth_ : usdg_;
        assetQuotePool = assetWethPool_;
        wethUsdgPool = wethUsdgPool_;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "OTF Uniswap V3 asset/USDG 1h TWAP";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return _latestRoundData();
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return _latestRoundData();
    }

    function quoteAssetInUsdg() public view returns (uint256 usdgAmount) {
        int24 assetQuoteTick = _meanTick(assetQuotePool);
        uint256 quoteAmount = UniswapV3TwapMath.quoteAtTick(assetQuoteTick, 1e18, asset, quoteToken);
        if (quoteToken == usdg) {
            if (quoteAmount == 0) revert InvalidTwapPrice();
            return quoteAmount;
        }
        int24 wethUsdgTick = _meanTick(wethUsdgPool);
        uint256 wethAmount = quoteAmount;
        if (wethAmount > type(uint128).max) revert InvalidTwapPrice();
        // The explicit upper-bound check above makes this narrowing cast safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 wethQuoteAmount = uint128(wethAmount);
        usdgAmount = UniswapV3TwapMath.quoteAtTick(wethUsdgTick, wethQuoteAmount, weth, usdg);
        if (usdgAmount == 0) revert InvalidTwapPrice();
    }

    function _latestRoundData()
        private
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        uint256 usdgAmount = quoteAssetInUsdg();
        // USDG uses six decimals; the feed exposes eight decimals like the incumbent price feeds.
        uint256 scaled = usdgAmount * 100;
        if (scaled > uint256(type(int256).max)) revert InvalidTwapPrice();
        roundId = uint80(block.number);
        // The explicit upper-bound check above guarantees the signed conversion is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        answer = int256(scaled);
        startedAt = block.timestamp - TWAP_WINDOW;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    function _meanTick(IUniswapV3OraclePool pool) private view returns (int24 arithmeticMeanTick) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int56 window = int56(uint56(TWAP_WINDOW));
        int56 mean = delta / window;
        if (delta < 0 && delta % window != 0) mean--;
        if (mean < type(int24).min || mean > type(int24).max) revert InvalidTwapPrice();
        // The explicit int24 bounds check above guarantees this narrowing cast is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        arithmeticMeanTick = int24(mean);
    }

    function _requirePair(IUniswapV3OraclePool pool, address first, address second) private view {
        if (!_isPair(pool, first, second)) revert InvalidPoolPair(address(pool));
    }

    function _isPair(IUniswapV3OraclePool pool, address first, address second)
        private
        view
        returns (bool)
    {
        address token0 = pool.token0();
        address token1 = pool.token1();
        return (token0 == first && token1 == second) || (token0 == second && token1 == first);
    }
}
