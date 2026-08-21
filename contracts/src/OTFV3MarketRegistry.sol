// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";
import { MathEx } from "./libraries/MathEx.sol";

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

    function createOfficialPool(address vault)
        external
        onlyOTFFactory
        nonReentrant
        returns (address pool)
    {
        if (!IOTFFactoryMarket(otfFactory).isVault(vault)) revert InvalidVault(vault);
        address current = officialPool[vault];
        if (current != address(0)) revert OfficialPoolAlreadySet(vault, current);
        if (
            IUniswapV3FactoryMarket(uniswapV3Factory).feeAmountTickSpacing(OFFICIAL_FEE)
                <= 0
        ) revert FeeTierUnavailable(OFFICIAL_FEE);

        uint256 nav = IManagedOTFMarketVault(vault).navPerShare();
        uint160 sqrtPriceX96 = _sqrtPriceX96(vault, nav);
        (address token0, address token1) = vault < settlementToken
            ? (vault, settlementToken)
            : (settlementToken, vault);

        address existing = IUniswapV3FactoryMarket(uniswapV3Factory).getPool(
            token0, token1, OFFICIAL_FEE
        );
        if (existing != address(0)) revert CanonicalPoolAlreadyExists(vault, existing);

        pool = INonfungiblePositionManagerMarket(positionManager)
            .createAndInitializePoolIfNecessary(
                token0, token1, OFFICIAL_FEE, sqrtPriceX96
            );
        address resolved = IUniswapV3FactoryMarket(uniswapV3Factory).getPool(
            token0, token1, OFFICIAL_FEE
        );
        if (pool == address(0) || pool != resolved) {
            revert PoolResolutionMismatch(pool, resolved);
        }

        officialPool[vault] = pool;
        emit OfficialPoolCreated(vault, pool, OFFICIAL_FEE, sqrtPriceX96, nav);
    }

    function _sqrtPriceX96(address vault, uint256 nav) private view returns (uint160) {
        uint256 settlementAmount = MathEx.mulDiv(
            nav, 10 ** uint256(settlementTokenDecimals), 1e18
        );
        if (nav == 0 || settlementAmount == 0) revert InvalidInitialPrice(nav);

        uint256 amount0 = vault < settlementToken ? 1e18 : settlementAmount;
        uint256 amount1 = vault < settlementToken ? settlementAmount : 1e18;
        uint256 ratioX192 = MathEx.mulDiv(amount1, Q192, amount0);
        uint256 result = _sqrt(ratioX192);
        if (result == 0 || result > type(uint160).max) revert InvalidInitialPrice(nav);
        // The bound above guarantees the narrowed Uniswap price cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(result);
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) return 0;
        result = 2 ** ((MathExLog2.log2(value) + 1) / 2);
        unchecked {
            for (uint256 i = 0; i < 7; i++) {
                result = (result + value / result) >> 1;
            }
            uint256 roundedDown = value / result;
            return result < roundedDown ? result : roundedDown;
        }
    }
}

library MathExLog2 {
    function log2(uint256 value) internal pure returns (uint256 result) {
        unchecked {
            if (value >> 128 > 0) { value >>= 128; result += 128; }
            if (value >> 64 > 0) { value >>= 64; result += 64; }
            if (value >> 32 > 0) { value >>= 32; result += 32; }
            if (value >> 16 > 0) { value >>= 16; result += 16; }
            if (value >> 8 > 0) { value >>= 8; result += 8; }
            if (value >> 4 > 0) { value >>= 4; result += 4; }
            if (value >> 2 > 0) { value >>= 2; result += 2; }
            if (value >> 1 > 0) result += 1;
        }
    }
}
