// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        returns (address pool);
}

interface IUniswapV3PoolImmutables {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}
