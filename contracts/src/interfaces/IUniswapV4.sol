// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev ABI-compatible with Uniswap v4-periphery's PathKey.
struct UniswapV4PathKey {
    address intermediateCurrency;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
    bytes hookData;
}

/// @dev ABI-compatible with Uniswap v4-periphery 2.1.1's ExactInputParams.
struct UniswapV4ExactInputParams {
    address currencyIn;
    UniswapV4PathKey[] path;
    uint256[] maxHopSlippage;
    uint128 amountIn;
    uint128 amountOutMinimum;
}

/// @dev ABI-compatible with Uniswap v4-core's PoolKey (Currency and IHooks encode as addresses).
struct UniswapV4PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @dev ABI-compatible with IPoolManager.SwapParams.
struct UniswapV4SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IUniswapV4ImmutableState {
    function poolManager() external view returns (address);
}

interface IUniswapV4StateView is IUniswapV4ImmutableState {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IUniswapV4PoolManager {
    function initialize(UniswapV4PoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (int24 tick);

    function unlock(bytes calldata data) external returns (bytes memory result);

    function swap(
        UniswapV4PoolKey calldata key,
        UniswapV4SwapParams calldata params,
        bytes calldata hookData
    ) external returns (int256 swapDelta);

    function sync(address currency) external;

    function settle() external payable returns (uint256 paid);

    function take(address currency, address to, uint256 amount) external;
}

interface IUniswapV4PositionManager is IUniswapV4ImmutableState {
    function nextTokenId() external view returns (uint256);

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface IUniswapUniversalRouter is IUniswapV4ImmutableState {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable;
}

interface IPermit2AllowanceTransfer {
    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);

    function approve(address token, address spender, uint160 amount, uint48 expiration) external;

    function transferFrom(address from, address to, uint160 amount, address token) external;
}
