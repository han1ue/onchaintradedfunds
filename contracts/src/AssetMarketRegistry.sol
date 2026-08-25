// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { MAX_ORACLE_STALENESS } from "./interfaces/IOracleTypes.sol";
import { IUniswapV3OraclePool } from "./UniswapV3RoutePriceFeed.sol";

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
}

interface IUniswapV3MarketFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

contract AssetMarketRegistry is IAssetMarketRegistry {
    struct QuoteTokenConfig {
        address usdFeed;
        uint32 maxStaleness;
        bool enabled;
        bool allowComposedChainlink;
        bool allowV3Twap;
    }

    struct Market {
        address asset;
        address pool;
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
    error InvalidQuoteToken(address quoteToken);
    error QuoteTokenConfigNotFound(address quoteToken);
    error QuoteTokenConfigMismatch(address quoteToken);
    error InvalidMaxStaleness(uint32 supplied);
    error InvalidOraclePrice(address quoteToken, int256 answer);
    error InvalidOracleTimestamp(address quoteToken, uint256 updatedAt);
    error IncompleteOracleRound(address quoteToken, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address quoteToken, uint256 updatedAt, uint32 maxStaleness);
    error UnsupportedFeedDecimals(address feed, uint8 decimals_);

    event MarketRegistered(
        bytes32 indexed marketId,
        address indexed asset,
        address indexed pool,
        address quoteToken,
        uint24 fee,
        address registrar
    );
    event MarketStatusChanged(bytes32 indexed marketId, bool active);
    event QuoteTokenConfigured(
        address indexed quoteToken,
        address indexed usdFeed,
        uint32 maxStaleness,
        bool allowComposedChainlink,
        bool allowV3Twap
    );
    event QuoteTokenStatusChanged(address indexed quoteToken, bool enabled);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    uint16 public constant TARGET_OBSERVATION_CARDINALITY = 64;
    uint32 public constant TWAP_WINDOW = 1 hours;

    address public owner;
    address public pendingOwner;
    address public immutable uniswapV3Factory;

    mapping(bytes32 => Market) private _marketFor;
    mapping(address => QuoteTokenConfig) private _quoteTokenConfig;
    address[] private _quoteTokens;

    constructor(address initialOwner, address uniswapV3Factory_) {
        if (initialOwner == address(0) || uniswapV3Factory_ == address(0)) revert ZeroAddress();
        if (uniswapV3Factory_.code.length == 0) revert InvalidDependency(uniswapV3Factory_);
        uniswapV3Factory = uniswapV3Factory_;
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function registerQuoteToken(
        address quoteToken,
        address usdFeed,
        uint32 maxStaleness,
        bool allowComposedChainlink,
        bool allowV3Twap
    ) external onlyOwner {
        if (quoteToken == address(0) || quoteToken.code.length == 0) {
            revert InvalidQuoteToken(quoteToken);
        }
        if (usdFeed == address(0) || usdFeed.code.length == 0) revert InvalidDependency(usdFeed);
        if (maxStaleness == 0 || maxStaleness > MAX_ORACLE_STALENESS) {
            revert InvalidMaxStaleness(maxStaleness);
        }
        _tokenDecimals(quoteToken);
        _validateUsdFeed(quoteToken, usdFeed, maxStaleness);
        if (_quoteTokenConfig[quoteToken].usdFeed == address(0)) _quoteTokens.push(quoteToken);
        _quoteTokenConfig[quoteToken] = QuoteTokenConfig({
            usdFeed: usdFeed,
            maxStaleness: maxStaleness,
            enabled: true,
            allowComposedChainlink: allowComposedChainlink,
            allowV3Twap: allowV3Twap
        });
        emit QuoteTokenConfigured(
            quoteToken, usdFeed, maxStaleness, allowComposedChainlink, allowV3Twap
        );
    }

    function setQuoteTokenEnabled(address quoteToken, bool enabled) external onlyOwner {
        QuoteTokenConfig storage config = _quoteTokenConfig[quoteToken];
        if (config.usdFeed == address(0)) revert QuoteTokenConfigNotFound(quoteToken);
        config.enabled = enabled;
        emit QuoteTokenStatusChanged(quoteToken, enabled);
    }

    function quoteTokens() external view returns (address[] memory) {
        return _quoteTokens;
    }

    function quoteTokenConfig(address quoteToken)
        external
        view
        returns (
            address usdFeed,
            uint32 maxStaleness,
            bool enabled,
            bool allowComposedChainlink,
            bool allowV3Twap
        )
    {
        QuoteTokenConfig storage config = _quoteTokenConfig[quoteToken];
        return (
            config.usdFeed,
            config.maxStaleness,
            config.enabled,
            config.allowComposedChainlink,
            config.allowV3Twap
        );
    }

    function validateQuoteToken(
        address quoteToken,
        address usdFeed,
        uint32 maxStaleness,
        bool forV3
    ) external view {
        _validateQuoteToken(quoteToken, usdFeed, maxStaleness, forV3);
    }

    function registerV3Market(address asset, address pool) external returns (bytes32 marketId) {
        _validateAsset(asset);
        address quoteToken = _quoteToken(pool, asset);
        uint24 fee = _validatePool(pool, asset, quoteToken);
        marketId = keccak256(abi.encode(block.chainid, asset, pool));
        Market storage existing = _marketFor[marketId];
        if (existing.asset != address(0)) return marketId;

        _marketFor[marketId] =
            Market({ asset: asset, pool: pool, quoteToken: quoteToken, fee: fee, active: true });
        emit MarketRegistered(marketId, asset, pool, quoteToken, fee, msg.sender);
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
        returns (address asset, address pool, uint24 fee, bool active)
    {
        Market storage market = _marketFor[marketId];
        return (market.asset, market.pool, market.fee, market.active);
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

    function _validateQuoteToken(
        address quoteToken,
        address usdFeed,
        uint32 maxStaleness,
        bool forV3
    ) private view {
        QuoteTokenConfig storage config = _quoteTokenConfig[quoteToken];
        if (config.usdFeed == address(0)) revert QuoteTokenConfigNotFound(quoteToken);
        if (
            !config.enabled || config.usdFeed != usdFeed || config.maxStaleness != maxStaleness
                || (forV3 ? !config.allowV3Twap : !config.allowComposedChainlink)
        ) revert QuoteTokenConfigMismatch(quoteToken);
    }

    function _tokenDecimals(address token) private view returns (uint8 tokenDecimals) {
        try IERC20Metadata(token).decimals() returns (uint8 decimals_) {
            tokenDecimals = decimals_;
        } catch {
            revert TokenDecimalsUnavailable(token);
        }
        if (tokenDecimals > 36) revert UnsupportedQuoteDecimals(token, tokenDecimals, 36);
    }

    function _validateUsdFeed(address quoteToken, address usdFeed, uint32 maxStaleness)
        private
        view
    {
        AggregatorV3Interface feed = AggregatorV3Interface(usdFeed);
        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();
        if (answer <= 0) revert InvalidOraclePrice(quoteToken, answer);
        // forge-lint: disable-next-line(block-timestamp)
        uint256 currentTimestamp = block.timestamp;
        if (
            roundId == 0 || startedAt == 0 || updatedAt == 0 || startedAt > updatedAt
                || updatedAt > currentTimestamp
        ) revert InvalidOracleTimestamp(quoteToken, updatedAt);
        if (answeredInRound < roundId) {
            revert IncompleteOracleRound(quoteToken, roundId, answeredInRound);
        }
        if (currentTimestamp > updatedAt + maxStaleness) {
            revert StaleOraclePrice(quoteToken, updatedAt, maxStaleness);
        }
        uint8 feedDecimals = feed.decimals();
        if (feedDecimals > 36) revert UnsupportedFeedDecimals(usdFeed, feedDecimals);
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
        QuoteTokenConfig storage config = _quoteTokenConfig[other];
        if (config.usdFeed == address(0)) revert InvalidQuoteToken(other);
        if (!config.enabled || !config.allowV3Twap) revert InvalidQuoteToken(other);
        return other;
    }
}
