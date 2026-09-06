// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapUniversalRouter,
    IUniswapV4ImmutableState,
    IUniswapV4StateView
} from "./interfaces/IUniswapV4.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

/// @notice Bounded Uniswap V4 exact-input adapter for one OTF entry/exit router.
/// @dev `data` is exclusively `abi.encode(PathKey[])`. This contract constructs the
///      Universal Router command and action streams; callers cannot supply either one.
contract UniswapV4Adapter is ITradeAdapter {
    using SafeTransferLib for address;

    uint256 public constant MAX_HOPS = ProtocolConstants.MAX_SWAP_HOPS;
    uint256 public constant MAX_HOOK_DATA_LENGTH = 1_024;
    uint24 private constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 private constant MAX_STATIC_FEE = 1_000_000;
    int24 private constant MAX_TICK_SPACING = 32_767;
    bytes1 private constant V4_SWAP_COMMAND = ProtocolConstants.UNISWAP_V4_SWAP_COMMAND;
    bytes1 private constant SWAP_EXACT_IN_ACTION =
        ProtocolConstants.UNISWAP_V4_SWAP_EXACT_IN_ACTION;
    bytes1 private constant SETTLE_ALL_ACTION = ProtocolConstants.UNISWAP_V4_SETTLE_ALL_ACTION;
    bytes1 private constant TAKE_ALL_ACTION = ProtocolConstants.UNISWAP_V4_TAKE_ALL_ACTION;

    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidAmount();
    error InvalidPath();
    error TooManyHops(uint256 supplied, uint256 maximum);
    error HookDataTooLong(uint256 supplied, uint256 maximum);
    error UnauthenticatedPool(bytes32 poolId);
    error RouterPoolManagerMismatch(address expected, address observed);
    error StateViewPoolManagerMismatch(address expected, address observed);
    error InputMismatch(uint256 expected, uint256 observed);
    error OutputMismatch(uint256 expected, uint256 observed);
    error AdapterBalanceMismatch(address token, uint256 expected, uint256 observed);
    error ApprovalMismatch(address token, address spender, uint256 expected, uint256 observed);
    error Permit2ApprovalMismatch(
        address token,
        address spender,
        uint160 expectedAmount,
        uint160 observedAmount,
        uint48 expectedExpiration,
        uint48 observedExpiration
    );
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error Reentrancy();

    address public immutable entryExitRouter;
    address public immutable uniswapV4PoolManager;
    address public immutable uniswapV4StateView;
    address public immutable uniswapUniversalRouter;
    address public immutable permit2;
    bool private _entered;

    constructor(
        address entryExitRouter_,
        address uniswapV4PoolManager_,
        address uniswapV4StateView_,
        address uniswapUniversalRouter_,
        address permit2_
    ) {
        _requireContract(entryExitRouter_);
        _requireContract(uniswapV4PoolManager_);
        _requireContract(uniswapV4StateView_);
        _requireContract(uniswapUniversalRouter_);
        _requireContract(permit2_);
        _requirePoolManagerBindings(
            uniswapV4PoolManager_, uniswapV4StateView_, uniswapUniversalRouter_
        );
        entryExitRouter = entryExitRouter_;
        uniswapV4PoolManager = uniswapV4PoolManager_;
        uniswapV4StateView = uniswapV4StateView_;
        uniswapUniversalRouter = uniswapUniversalRouter_;
        permit2 = permit2_;
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
        if (
            amountIn == 0 || minAmountOut == 0 || tokenIn == tokenOut
                || amountIn > type(uint128).max || minAmountOut > type(uint128).max
        ) {
            revert InvalidAmount();
        }
        PathKey[] memory path = abi.decode(data, (PathKey[]));
        _validatePath(path, tokenIn, tokenOut);
        _requirePoolManagerBindings(
            uniswapV4PoolManager, uniswapV4StateView, uniswapUniversalRouter
        );

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        if (inputBefore < amountIn) revert InputMismatch(amountIn, inputBefore);
        uint256 adapterOutputBefore = IERC20(tokenOut).balanceOf(address(this));
        uint256 routerOutputBefore = IERC20(tokenOut).balanceOf(entryExitRouter);

        _approveExact(tokenIn, permit2, 0);
        _approveExact(tokenIn, permit2, amountIn);
        // The allowance is consumed in this transaction and revoked immediately afterwards.
        // forge-lint: disable-next-line(block-timestamp)
        uint48 expiration = uint48(block.timestamp + 1);
        // Safe because both values were bounded to uint128 above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 permitAmount = uint160(amountIn);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 exactAmountIn = uint128(amountIn);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 exactMinimumOut = uint128(minAmountOut);
        _approvePermit2(tokenIn, uniswapUniversalRouter, permitAmount, expiration);
        _executeExactInput(path, tokenIn, tokenOut, exactAmountIn, exactMinimumOut);
        _approvePermit2(tokenIn, uniswapUniversalRouter, 0, 0);
        _approveExact(tokenIn, permit2, 0);

        uint256 inputAfter = IERC20(tokenIn).balanceOf(address(this));
        uint256 observedInput = inputBefore >= inputAfter ? inputBefore - inputAfter : 0;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        uint256 adapterOutputAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = adapterOutputAfter >= adapterOutputBefore
            ? adapterOutputAfter - adapterOutputBefore
            : 0;
        if (amountOut < minAmountOut) revert MinimumOutputNotMet(minAmountOut, amountOut);

        tokenOut.safeTransfer(entryExitRouter, amountOut);
        uint256 finalAdapterOutput = IERC20(tokenOut).balanceOf(address(this));
        if (finalAdapterOutput != adapterOutputBefore) {
            revert AdapterBalanceMismatch(tokenOut, adapterOutputBefore, finalAdapterOutput);
        }
        uint256 routerOutputAfter = IERC20(tokenOut).balanceOf(entryExitRouter);
        uint256 observedOutput =
            routerOutputAfter >= routerOutputBefore ? routerOutputAfter - routerOutputBefore : 0;
        if (observedOutput != amountOut) revert OutputMismatch(amountOut, observedOutput);
    }

    function _executeExactInput(
        PathKey[] memory path,
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint128 minAmountOut
    ) private {
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(
            IV4Router.ExactInputParams({
                currencyIn: Currency.wrap(tokenIn),
                path: path,
                minHopPriceX36: new uint256[](0),
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            })
        );
        actionParams[1] = abi.encode(tokenIn, uint256(amountIn));
        actionParams[2] = abi.encode(tokenOut, uint256(minAmountOut));

        bytes[] memory commandInputs = new bytes[](1);
        commandInputs[0] = abi.encode(
            abi.encodePacked(SWAP_EXACT_IN_ACTION, SETTLE_ALL_ACTION, TAKE_ALL_ACTION), actionParams
        );
        // The deadline is evaluated inside this same transaction.
        // forge-lint: disable-next-line(block-timestamp)
        IUniswapUniversalRouter(uniswapUniversalRouter)
            .execute(abi.encodePacked(V4_SWAP_COMMAND), commandInputs, block.timestamp);
    }

    function _validatePath(PathKey[] memory path, address tokenIn, address tokenOut) private view {
        uint256 hops = path.length;
        if (hops == 0) revert InvalidPath();
        if (hops > MAX_HOPS) revert TooManyHops(hops, MAX_HOPS);

        address current = tokenIn;
        for (uint256 i = 0; i < hops; i++) {
            PathKey memory hop = path[i];
            address next = Currency.unwrap(hop.intermediateCurrency);
            if (
                next == address(0) || next == current
                    || (hop.fee > MAX_STATIC_FEE && hop.fee != DYNAMIC_FEE_FLAG)
                    || hop.tickSpacing <= 0 || hop.tickSpacing > MAX_TICK_SPACING
            ) {
                revert InvalidPath();
            }
            _requireContract(next);
            if (hop.hookData.length > MAX_HOOK_DATA_LENGTH) {
                revert HookDataTooLong(hop.hookData.length, MAX_HOOK_DATA_LENGTH);
            }
            bytes32 poolId = _poolId(current, next, hop.fee, hop.tickSpacing, address(hop.hooks));
            (uint160 sqrtPriceX96,,,) = IUniswapV4StateView(uniswapV4StateView).getSlot0(poolId);
            if (sqrtPriceX96 == 0) revert UnauthenticatedPool(poolId);
            current = next;
        }
        if (current != tokenOut) revert InvalidPath();
    }

    function _poolId(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, address hooks)
        private
        pure
        returns (bytes32)
    {
        (address currency0, address currency1) =
            tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks));
    }

    function _requirePoolManagerBindings(
        address expected,
        address stateView,
        address universalRouter
    ) private view {
        address observedStateView = IUniswapV4ImmutableState(stateView).poolManager();
        if (observedStateView != expected) {
            revert StateViewPoolManagerMismatch(expected, observedStateView);
        }
        address observedRouter = IUniswapV4ImmutableState(universalRouter).poolManager();
        if (observedRouter != expected) {
            revert RouterPoolManagerMismatch(expected, observedRouter);
        }
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        token.safeApprove(spender, amount);
        uint256 observed = IERC20(token).allowance(address(this), spender);
        if (observed != amount) revert ApprovalMismatch(token, spender, amount, observed);
    }

    function _approvePermit2(address token, address spender, uint160 amount, uint48 expiration)
        private
    {
        IPermit2AllowanceTransfer(permit2).approve(token, spender, amount, expiration);
        // Permit2 stores the current timestamp when the requested expiration is zero.
        // forge-lint: disable-next-line(block-timestamp)
        if (expiration == 0) expiration = uint48(block.timestamp);
        (uint160 observedAmount, uint48 observedExpiration,) =
            IPermit2AllowanceTransfer(permit2).allowance(address(this), token, spender);
        if (observedAmount != amount || observedExpiration != expiration) {
            revert Permit2ApprovalMismatch(
                token, spender, amount, observedAmount, expiration, observedExpiration
            );
        }
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
