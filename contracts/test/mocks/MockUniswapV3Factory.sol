// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IUniswapV3Factory,
    IUniswapV3PoolImmutables
} from "../../src/interfaces/IUniswapV3Factory.sol";

contract MockUniswapV3Pool is IUniswapV3PoolImmutables {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    constructor(address factory_, address tokenA, address tokenB, uint24 fee_) {
        factory = factory_;
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
    }
}

contract MockUniswapV3Factory is IUniswapV3Factory {
    mapping(bytes32 => address) private _pools;

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (address pool)
    {
        pool = address(new MockUniswapV3Pool(address(this), tokenA, tokenB, fee));
        _pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        _pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        returns (address pool)
    {
        return _pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}
