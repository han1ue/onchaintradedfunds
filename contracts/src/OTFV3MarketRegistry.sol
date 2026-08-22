// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

interface IOTFFactoryMarket {
    function isVault(address vault) external view returns (bool);
}

interface IManagedOTFMarketVault {
    function navPerShare() external view returns (uint256);
}

interface IUniswapV3FactoryMarket {
    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        returns (address pool);

    function feeAmountTickSpacing(uint24 fee) external view returns (int24 tickSpacing);
}

interface INonfungiblePositionManagerMarket {
    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);
}

interface IUniswapV3PoolMarket {
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

/// @notice Creates and records the single canonical Uniswap V3 market for every OTF.
/// @dev The factory calls this during vault creation. No account can replace or remove a pool.
contract OTFV3MarketRegistry {
    uint24 public constant OFFICIAL_FEE = 500;
    uint256 private constant Q192 = 1 << 192;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidSettlementDecimals(uint8 decimals);
    error NotOTFFactory(address caller);
    error InvalidVault(address vault);
    error OfficialPoolAlreadySet(address vault, address pool);
    error CanonicalPoolAlreadyExists(address vault, address pool);
    error FeeTierUnavailable(uint24 fee);
    error InvalidInitialPrice(uint256 navPerShare);
    error PoolResolutionMismatch(address returnedPool, address resolvedPool);
    error PoolInitializationMismatch(uint160 requestedSqrtPriceX96, uint160 actualSqrtPriceX96);
    error Reentrancy();

    event OfficialPoolCreated(
        address indexed vault,
        address indexed pool,
        uint24 fee,
        uint160 requestedSqrtPriceX96,
        uint256 navPerShare
    );

    address public immutable otfFactory;
    address public immutable settlementToken;
    address public immutable uniswapV3Factory;
    address public immutable positionManager;
    uint8 public immutable settlementTokenDecimals;

    mapping(address vault => address pool) public officialPool;

    bool private _entered;

    constructor(
        address otfFactory_,
        address settlementToken_,
        address uniswapV3Factory_,
        address positionManager_
    ) {
        if (
            otfFactory_ == address(0) || settlementToken_ == address(0)
                || uniswapV3Factory_ == address(0) || positionManager_ == address(0)
        ) revert ZeroAddress();
        if (otfFactory_.code.length == 0) revert InvalidDependency(otfFactory_);
        if (settlementToken_.code.length == 0) revert InvalidDependency(settlementToken_);
        if (uniswapV3Factory_.code.length == 0) revert InvalidDependency(uniswapV3Factory_);
        if (positionManager_.code.length == 0) revert InvalidDependency(positionManager_);

        uint8 decimals = IERC20Metadata(settlementToken_).decimals();
        if (decimals > 18) revert InvalidSettlementDecimals(decimals);

        otfFactory = otfFactory_;
        settlementToken = settlementToken_;
        uniswapV3Factory = uniswapV3Factory_;
        positionManager = positionManager_;
        settlementTokenDecimals = decimals;
    }

    modifier onlyOTFFactory() {
        if (msg.sender != otfFactory) revert NotOTFFactory(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Returns the canonical V3 pool for a prospective or deployed OTF address.
    function canonicalPool(address vault) external view returns (address pool) {
        return
            IUniswapV3FactoryMarket(uniswapV3Factory).getPool(vault, settlementToken, OFFICIAL_FEE);
    }

    function isInitializedPool(address pool) external view returns (bool initialized) {
        return _poolSqrtPriceX96(pool) != 0;
    }

    function createOfficialPool(address vault)
        external
        onlyOTFFactory
        nonReentrant
        returns (address pool)
    {
        if (!IOTFFactoryMarket(otfFactory).isVault(vault)) revert InvalidVault(vault);
        address current = officialPool[vault];
        if (current != address(0)) revert OfficialPoolAlreadySet(vault, current);
        if (IUniswapV3FactoryMarket(uniswapV3Factory).feeAmountTickSpacing(OFFICIAL_FEE) <= 0) {
            revert FeeTierUnavailable(OFFICIAL_FEE);
        }

        uint256 nav = IManagedOTFMarketVault(vault).navPerShare();
        uint160 sqrtPriceX96 = _sqrtPriceX96(vault, nav);
        (address token0, address token1) =
            vault < settlementToken ? (vault, settlementToken) : (settlementToken, vault);

        address existing =
            IUniswapV3FactoryMarket(uniswapV3Factory).getPool(token0, token1, OFFICIAL_FEE);
        if (existing != address(0) && _poolSqrtPriceX96(existing) != 0) {
            revert CanonicalPoolAlreadyExists(vault, existing);
        }

        pool = INonfungiblePositionManagerMarket(positionManager)
            .createAndInitializePoolIfNecessary(token0, token1, OFFICIAL_FEE, sqrtPriceX96);
        address resolved =
            IUniswapV3FactoryMarket(uniswapV3Factory).getPool(token0, token1, OFFICIAL_FEE);
        if (pool == address(0) || pool != resolved) {
            revert PoolResolutionMismatch(pool, resolved);
        }
        uint160 actualSqrtPriceX96 = _poolSqrtPriceX96(pool);
        if (actualSqrtPriceX96 != sqrtPriceX96) {
            revert PoolInitializationMismatch(sqrtPriceX96, actualSqrtPriceX96);
        }

        officialPool[vault] = pool;
        emit OfficialPoolCreated(vault, pool, OFFICIAL_FEE, sqrtPriceX96, nav);
    }

    function _poolSqrtPriceX96(address pool) private view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,,,,) = IUniswapV3PoolMarket(pool).slot0();
    }

    function _sqrtPriceX96(address vault, uint256 nav) private view returns (uint160) {
        uint256 settlementAmount = Math.mulDiv(nav, 10 ** uint256(settlementTokenDecimals), 1e18);
        if (nav == 0 || settlementAmount == 0) revert InvalidInitialPrice(nav);

        uint256 amount0 = vault < settlementToken ? 1e18 : settlementAmount;
        uint256 amount1 = vault < settlementToken ? settlementAmount : 1e18;
        uint256 ratioX192 = Math.mulDiv(amount1, Q192, amount0);
        uint256 result = Math.sqrt(ratioX192);
        if (result == 0 || result > type(uint160).max) revert InvalidInitialPrice(nav);
        // The bound above guarantees the narrowed Uniswap price cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(result);
    }
}
