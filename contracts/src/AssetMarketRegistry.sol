// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { IUniswapV3OraclePool, UniswapV3RoutePriceFeed } from "./UniswapV3RoutePriceFeed.sol";

interface IUniswapV3MarketPool is IUniswapV3OraclePool {
    function factory() external view returns (address);
    function fee() external view returns (uint24);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

interface IUniswapV3MarketFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

contract AssetMarketRegistry is IAssetMarketRegistry {
    struct Market {
        address asset;
        address pool;
        address priceFeed;
        address quoteToken;
        uint24 fee;
        bool active;
    }

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error AssetNotContract(address asset);
    error UnsupportedAssetDecimals(address asset, uint8 decimals_);
    error UnsupportedQuoteDecimals(address token, uint8 decimals_, uint8 required);
    error TokenDecimalsUnavailable(address asset);
    error InvalidPool(address pool);
    error InvalidPoolPair(address pool, address asset);
    error UnsupportedFeeTier(uint24 fee);
    error PoolNotInitialized(address pool);
    error InsufficientObservationCapacity(address pool, uint16 current, uint16 required);
    error InsufficientTwapHistory(address pool, uint32 requiredWindow);
    error MarketNotFound(bytes32 marketId);

    event MarketRegistered(
        bytes32 indexed marketId,
        address indexed asset,
        address indexed pool,
        address priceFeed,
        address quoteToken,
        uint24 fee,
        address registrar
    );
    event MarketStatusChanged(bytes32 indexed marketId, bool active);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    uint16 public constant TARGET_OBSERVATION_CARDINALITY = 64;
    uint32 public constant TWAP_WINDOW = 1 hours;

    address public owner;
    address public pendingOwner;
    address public immutable uniswapV3Factory;
    address public immutable weth;
    address public immutable usdg;
    address public immutable wethUsdgPool;

    mapping(bytes32 => Market) private _marketFor;

    constructor(
        address initialOwner,
        address uniswapV3Factory_,
        address weth_,
        address usdg_,
        address wethUsdgPool_
    ) {
        if (
            initialOwner == address(0) || uniswapV3Factory_ == address(0) || weth_ == address(0)
                || usdg_ == address(0) || wethUsdgPool_ == address(0)
        ) revert ZeroAddress();
        if (uniswapV3Factory_.code.length == 0) revert InvalidDependency(uniswapV3Factory_);
        if (weth_.code.length == 0) revert InvalidDependency(weth_);
        if (usdg_.code.length == 0) revert InvalidDependency(usdg_);
        if (wethUsdgPool_.code.length == 0) revert InvalidDependency(wethUsdgPool_);
        uniswapV3Factory = uniswapV3Factory_;
        weth = weth_;
        usdg = usdg_;
        wethUsdgPool = wethUsdgPool_;
        _requireDecimals(weth_, 18);
        _requireDecimals(usdg_, 6);
        _validatePool(wethUsdgPool_, weth_, usdg_);
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function registerV3Market(address asset, address pool) external returns (bytes32 marketId) {
        _validateAsset(asset);
        address quoteToken = _quoteToken(pool, asset);
        uint24 fee = _validatePool(pool, asset, quoteToken);
        marketId = keccak256(abi.encode(block.chainid, asset, pool));
        Market storage existing = _marketFor[marketId];
        if (existing.asset != address(0)) return marketId;

        UniswapV3RoutePriceFeed priceFeed = new UniswapV3RoutePriceFeed(
            asset, weth, usdg, IUniswapV3OraclePool(pool), IUniswapV3OraclePool(wethUsdgPool)
        );
        _marketFor[marketId] = Market({
            asset: asset,
            pool: pool,
            priceFeed: address(priceFeed),
            quoteToken: quoteToken,
            fee: fee,
            active: true
        });
        emit MarketRegistered(
            marketId, asset, pool, address(priceFeed), quoteToken, fee, msg.sender
        );
    }

    function setMarketActive(bytes32 marketId, bool active) external onlyOwner {
        Market storage market = _marketFor[marketId];
        if (market.asset == address(0)) revert MarketNotFound(marketId);
        market.active = active;
        emit MarketStatusChanged(marketId, active);
    }

    function marketFor(bytes32 marketId)
        external
        view
        returns (address asset, address pool, address priceFeed, uint24 fee, bool active)
    {
        Market storage market = _marketFor[marketId];
        return (market.asset, market.pool, market.priceFeed, market.fee, market.active);
    }

    function isActiveMarketForAsset(bytes32 marketId, address asset) external view returns (bool) {
        Market storage market = _marketFor[marketId];
        return market.active && market.asset == asset;
    }

    function quoteTokenFor(bytes32 marketId) external view returns (address) {
        return _marketFor[marketId].quoteToken;
    }

    function beginOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnershipTransfer() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function _validateAsset(address asset) private view {
        if (asset == address(0)) revert ZeroAddress();
        if (asset.code.length == 0) revert AssetNotContract(asset);
        uint8 tokenDecimals;
        try IERC20Metadata(asset).decimals() returns (uint8 decimals_) {
            tokenDecimals = decimals_;
        } catch {
            revert TokenDecimalsUnavailable(asset);
        }
        if (tokenDecimals != 18) revert UnsupportedAssetDecimals(asset, tokenDecimals);
    }

    function _requireDecimals(address token, uint8 required) private view {
        uint8 tokenDecimals;
        try IERC20Metadata(token).decimals() returns (uint8 decimals_) {
            tokenDecimals = decimals_;
        } catch {
            revert TokenDecimalsUnavailable(token);
        }
        if (tokenDecimals != required) {
            revert UnsupportedQuoteDecimals(token, tokenDecimals, required);
        }
    }

    function _validatePool(address pool, address first, address second)
        private
        view
        returns (uint24 fee)
    {
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool(pool);
        IUniswapV3MarketPool candidate = IUniswapV3MarketPool(pool);
        if (candidate.factory() != uniswapV3Factory) revert InvalidPool(pool);
        address token0 = candidate.token0();
        address token1 = candidate.token1();
        if (!((token0 == first && token1 == second) || (token0 == second && token1 == first))) {
            revert InvalidPoolPair(pool, first);
        }
        fee = candidate.fee();
        if (IUniswapV3MarketFactory(uniswapV3Factory).feeAmountTickSpacing(fee) == 0) {
            revert UnsupportedFeeTier(fee);
        }
        if (IUniswapV3MarketFactory(uniswapV3Factory).getPool(first, second, fee) != pool) {
            revert InvalidPool(pool);
        }
        (uint160 sqrtPriceX96,,, uint16 observationCardinality,,,) = candidate.slot0();
        if (sqrtPriceX96 == 0) revert PoolNotInitialized(pool);
        if (observationCardinality < TARGET_OBSERVATION_CARDINALITY) {
            revert InsufficientObservationCapacity(
                pool, observationCardinality, TARGET_OBSERVATION_CARDINALITY
            );
        }
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        secondsAgos[1] = 0;
        try candidate.observe(secondsAgos) returns (int56[] memory ticks, uint160[] memory) {
            if (ticks.length != 2) {
                revert InsufficientTwapHistory(pool, TWAP_WINDOW);
            }
        } catch {
            revert InsufficientTwapHistory(pool, TWAP_WINDOW);
        }
    }

    function _quoteToken(address pool, address asset) private view returns (address quoteToken) {
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool(pool);
        IUniswapV3MarketPool candidate = IUniswapV3MarketPool(pool);
        address token0 = candidate.token0();
        address token1 = candidate.token1();
        address other;
        if (token0 == asset) other = token1;
        else if (token1 == asset) other = token0;
        else revert InvalidPoolPair(pool, asset);
        if (other != weth && other != usdg) revert InvalidPoolPair(pool, asset);
        return other;
    }
}
