// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { IUniswapV3Factory, IUniswapV3PoolImmutables } from "./interfaces/IUniswapV3Factory.sol";
import { IUniswapV3SwapRouter } from "./interfaces/IUniswapV3SwapRouter.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { UniswapV3Path } from "./libraries/UniswapV3Path.sol";

/// @notice Bounded Uniswap V3 exact-input adapter for one OTF entry/exit router.
contract UniswapV3Adapter is ITradeAdapter {
    using SafeTransferLib for address;

    uint256 public constant MAX_HOPS = ProtocolConstants.MAX_SWAP_HOPS;

    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidAmount();
    error InvalidPath();
    error TooManyHops(uint256 supplied, uint256 maximum);
    error UnauthenticatedPool(address token0, address token1, uint24 fee, address pool);
    error RouterFactoryMismatch(address expected, address observed);
    error InputMismatch(uint256 expected, uint256 observed);
    error OutputMismatch(uint256 reported, uint256 observed);
    error AdapterBalanceMismatch(address token, uint256 expected, uint256 observed);
    error ApprovalMismatch(address token, address spender, uint256 expected, uint256 observed);
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error Reentrancy();

    address public immutable entryExitRouter;
    address public immutable uniswapV3Factory;
    address public immutable uniswapV3Router;
    bool private _entered;

    constructor(address entryExitRouter_, address uniswapV3Factory_, address uniswapV3Router_) {
        _requireContract(entryExitRouter_);
        _requireContract(uniswapV3Factory_);
        _requireContract(uniswapV3Router_);
        address observedFactory = IUniswapV3SwapRouter(uniswapV3Router_).factory();
        if (observedFactory != uniswapV3Factory_) {
            revert RouterFactoryMismatch(uniswapV3Factory_, observedFactory);
        }
        entryExitRouter = entryExitRouter_;
        uniswapV3Factory = uniswapV3Factory_;
        uniswapV3Router = uniswapV3Router_;
    }

    modifier onlyEntryExitRouter() {
        if (msg.sender != entryExitRouter) revert UnauthorizedCaller(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyEntryExitRouter nonReentrant returns (uint256 amountOut) {
        _requireContract(tokenIn);
        _requireContract(tokenOut);
        if (amountIn == 0 || minAmountOut == 0 || tokenIn == tokenOut) revert InvalidAmount();
        _validatePath(data, tokenIn, tokenOut);
        address observedFactory = IUniswapV3SwapRouter(uniswapV3Router).factory();
        if (observedFactory != uniswapV3Factory) {
            revert RouterFactoryMismatch(uniswapV3Factory, observedFactory);
        }

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        if (inputBefore < amountIn) revert InputMismatch(amountIn, inputBefore);
        uint256 expectedInputAfter = inputBefore - amountIn;
        uint256 adapterOutputBefore = IERC20(tokenOut).balanceOf(address(this));
        uint256 routerOutputBefore = IERC20(tokenOut).balanceOf(entryExitRouter);

        _approveExact(tokenIn, uniswapV3Router, 0);
        _approveExact(tokenIn, uniswapV3Router, amountIn);
        uint256 reported = IUniswapV3SwapRouter(uniswapV3Router)
            .exactInput(
                IUniswapV3SwapRouter.ExactInputParams({
                path: data,
                recipient: entryExitRouter,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            })
            );
        _approveExact(tokenIn, uniswapV3Router, 0);

        uint256 inputAfter = IERC20(tokenIn).balanceOf(address(this));
        if (inputAfter != expectedInputAfter) {
            uint256 observedInput = inputBefore >= inputAfter ? inputBefore - inputAfter : 0;
            revert InputMismatch(amountIn, observedInput);
        }
        uint256 adapterOutputAfter = IERC20(tokenOut).balanceOf(address(this));
        if (adapterOutputAfter != adapterOutputBefore) {
            revert AdapterBalanceMismatch(tokenOut, adapterOutputBefore, adapterOutputAfter);
        }
        uint256 routerOutputAfter = IERC20(tokenOut).balanceOf(entryExitRouter);
        amountOut =
            routerOutputAfter >= routerOutputBefore ? routerOutputAfter - routerOutputBefore : 0;
        if (reported != amountOut) revert OutputMismatch(reported, amountOut);
        if (amountOut < minAmountOut) revert MinimumOutputNotMet(minAmountOut, amountOut);
    }

    function _validatePath(bytes calldata path, address tokenIn, address tokenOut) private view {
        uint256 hops = UniswapV3Path.hopCount(path);
        if (hops == 0) revert InvalidPath();
        if (hops > MAX_HOPS) revert TooManyHops(hops, MAX_HOPS);
        if (
            UniswapV3Path.tokenAt(path, 0) != tokenIn
                || UniswapV3Path.tokenAt(path, hops) != tokenOut
        ) {
            revert InvalidPath();
        }
        for (uint256 i = 0; i < hops; i++) {
            address current = UniswapV3Path.tokenAt(path, i);
            address next = UniswapV3Path.tokenAt(path, i + 1);
            uint24 fee = UniswapV3Path.feeAt(path, i);
            if (current == address(0) || next == address(0) || current == next || fee == 0) {
                revert InvalidPath();
            }
            _authenticatePool(current, next, fee);
        }
    }

    function _authenticatePool(address tokenA, address tokenB, uint24 fee) private view {
        address pool = IUniswapV3Factory(uniswapV3Factory).getPool(tokenA, tokenB, fee);
        address token0 = tokenA < tokenB ? tokenA : tokenB;
        address token1 = tokenA < tokenB ? tokenB : tokenA;
        if (pool.code.length == 0) {
            revert UnauthenticatedPool(token0, token1, fee, pool);
        }
        IUniswapV3PoolImmutables candidate = IUniswapV3PoolImmutables(pool);
        if (
            candidate.factory() != uniswapV3Factory || candidate.token0() != token0
                || candidate.token1() != token1 || candidate.fee() != fee
        ) {
            revert UnauthenticatedPool(token0, token1, fee, pool);
        }
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        token.safeApprove(spender, amount);
        uint256 observed = IERC20(token).allowance(address(this), spender);
        if (observed != amount) revert ApprovalMismatch(token, spender, amount, observed);
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
