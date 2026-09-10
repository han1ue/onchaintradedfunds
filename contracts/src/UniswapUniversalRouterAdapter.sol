// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { IUniswapV3Factory, IUniswapV3PoolImmutables } from "./interfaces/IUniswapV3Factory.sol";
import {
    IUniswapUniversalRouter,
    IUniswapV4StateView,
    IPermit2AllowanceTransfer
} from "./interfaces/IUniswapV4.sol";
import { UniswapV3Path } from "./libraries/UniswapV3Path.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

interface IUniversalAdapterEntryRouter {
    function weth() external view returns (address);
}

/// @notice Ordered V3/V4 exact-input batches through Universal Router release 2.1.1.
/// @dev Route data is 0x03 || packed V3 path, or 0x04 || abi.encode(currencyIn, PathKey[]).
///      Only this contract constructs commands, recipients and payment actions.
contract UniswapUniversalRouterAdapter is ITradeAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_HOPS = ProtocolConstants.MAX_SWAP_HOPS;
    uint256 public constant MAX_TRADES = 40;
    uint256 public constant MAX_TOKENS = MAX_TRADES * (MAX_HOPS + 1);
    uint256 private constant CONTRACT_BALANCE = 1 << 255;
    address private constant THIS = address(2);

    error UnauthorizedCaller(address caller);
    error InvalidDependency(address dependency);
    error InvalidPlan();
    error InvalidPath();
    error UnauthenticatedPool();
    error InsufficientBalance(address token, uint256 available, uint256 required);
    error BalanceMismatch(address token, uint256 expected, uint256 observed);
    error DeadlineExpired();

    address public immutable entryExitRouter;
    address public immutable weth;
    address public immutable uniswapV3Factory;
    bytes32 public immutable v3PoolInitCodeHash;
    address public immutable uniswapV4PoolManager;
    address public immutable uniswapV4StateView;
    address public immutable uniswapUniversalRouter;
    address public immutable permit2;
    bytes32 private immutable routerCodehash;

    struct Commands {
        bytes codes;
        bytes[] inputs;
        uint256 count;
    }

    constructor(
        address router,
        address factory,
        bytes32 poolHash,
        address manager,
        address stateView,
        address universal,
        address permit
    ) {
        _contract(router);
        _contract(factory);
        _contract(manager);
        _contract(stateView);
        _contract(universal);
        _contract(permit);
        address wrapped = IUniversalAdapterEntryRouter(router).weth();
        _contract(wrapped);
        if (
            poolHash == bytes32(0) || IUniswapV4StateView(stateView).poolManager() != manager
                || IUniswapUniversalRouter(universal).poolManager() != manager
        ) revert InvalidDependency(universal);
        entryExitRouter = router;
        weth = wrapped;
        uniswapV3Factory = factory;
        v3PoolInitCodeHash = poolHash;
        uniswapV4PoolManager = manager;
        uniswapV4StateView = stateView;
        uniswapUniversalRouter = universal;
        permit2 = permit;
        routerCodehash = universal.codehash;
    }

    function routeTokens(Trade[] calldata trades) external view returns (address[] memory) {
        return _tokens(trades);
    }

    function executeBatch(
        Trade[] calldata trades,
        address[] calldata tokens,
        uint256[] calldata funding,
        uint256 deadline
    ) external nonReentrant returns (uint256[] memory returned) {
        if (msg.sender != entryExitRouter) revert UnauthorizedCaller(msg.sender);
        // Transaction deadlines intentionally use the chain timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired();
        address[] memory required = _tokens(trades);
        if (tokens.length != required.length || funding.length != tokens.length) {
            revert InvalidPlan();
        }
        if (
            uniswapUniversalRouter.codehash != routerCodehash
                || IUniswapV4StateView(uniswapV4StateView).poolManager() != uniswapV4PoolManager
                || IUniswapUniversalRouter(uniswapUniversalRouter).poolManager()
                    != uniswapV4PoolManager
        ) revert InvalidDependency(uniswapUniversalRouter);

        uint256 n = tokens.length;
        uint256[] memory baseline = new uint256[](n);
        uint256[] memory reserves = new uint256[](n);
        uint256[] memory minimum = new uint256[](n);
        uint256[] memory directMinimum = new uint256[](n);
        uint256[] memory routerBefore = new uint256[](n);
        Commands memory plan = Commands(
            new bytes(4 * MAX_TRADES + 2 * MAX_TOKENS + 5),
            new bytes[](4 * MAX_TRADES + 2 * MAX_TOKENS + 5),
            0
        );
        // Native currency is represented by WETH at every trade boundary. Temporarily
        // escrow old router ETH as WETH, so balance sentinels cannot spend that ETH.
        uint256 nativeReserve = uniswapUniversalRouter.balance;
        bool usesWeth;
        for (uint256 i; i < n; ++i) {
            if (tokens[i] == weth) usesWeth = true;
        }
        if (usesWeth && nativeReserve != 0) _append(plan, 0x0b, abi.encode(THIS, nativeReserve));
        for (uint256 i; i < n; ++i) {
            if (tokens[i] != required[i]) revert InvalidPlan();
            uint256 balance = IERC20(tokens[i]).balanceOf(address(this));
            if (balance < funding[i]) revert InsufficientBalance(tokens[i], balance, funding[i]);
            baseline[i] = balance - funding[i];
            routerBefore[i] = IERC20(tokens[i]).balanceOf(entryExitRouter);
            minimum[i] = funding[i];
            reserves[i] = IERC20(tokens[i]).balanceOf(uniswapUniversalRouter);
            uint256 escrow = reserves[i] + (usesWeth && tokens[i] == weth ? nativeReserve : 0);
            if (escrow != 0) _append(plan, 0x05, abi.encode(tokens[i], address(this), escrow));
            if (funding[i] != 0) _transferExact(tokens[i], uniswapUniversalRouter, funding[i]);
        }
        for (uint256 i; i < trades.length; ++i) {
            Trade calldata trade = trades[i];
            uint256 input = _index(tokens, trade.tokenIn);
            uint256 output = _index(tokens, trade.tokenOut);
            uint256 amount = trade.amountIn;
            if (amount == type(uint256).max) {
                minimum[input] = 0;
            } else {
                if (amount > minimum[input]) {
                    revert InsufficientBalance(trade.tokenIn, minimum[input], amount);
                }
                minimum[input] -= amount;
            }
            minimum[output] += trade.minAmountOut;
            bool finalOutput = true;
            for (uint256 j = i + 1; j < trades.length; ++j) {
                if (trades[j].tokenIn == trade.tokenOut) {
                    finalOutput = false;
                    break;
                }
            }
            if (finalOutput) directMinimum[output] += trade.minAmountOut;
            _swap(plan, trade, finalOutput ? entryExitRouter : THIS);
        }
        for (uint256 i; i < n; ++i) {
            _append(
                plan, 0x04, abi.encode(tokens[i], entryExitRouter, minimum[i] - directMinimum[i])
            );
        }
        // ERC20 reserves are restored after execute. ETH can only enter Universal Router
        // through execute, WETH or PoolManager; restore it inside this same command stream.
        if (usesWeth && nativeReserve != 0) {
            if (nativeReserve > type(uint160).max) revert InvalidPlan();
            IERC20(weth).forceApprove(permit2, nativeReserve);
            IPermit2AllowanceTransfer(permit2)
                .approve(
                    weth,
                    uniswapUniversalRouter,
                    // The uint160 bound is checked above.
                    // forge-lint: disable-next-line(unsafe-typecast)
                    uint160(nativeReserve),
                    uint48(block.timestamp)
                );
            // The same checked reserve is transferred by this command.
            // forge-lint: disable-next-line(unsafe-typecast)
            _append(plan, 0x02, abi.encode(weth, THIS, uint160(nativeReserve)));
            _append(plan, 0x0c, abi.encode(THIS, nativeReserve));
        }
        bytes memory codes = plan.codes;
        bytes[] memory inputs = plan.inputs;
        uint256 count = plan.count;
        assembly ("memory-safe") {
            mstore(codes, count)
            mstore(inputs, count)
        }
        IUniswapUniversalRouter(uniswapUniversalRouter).execute(codes, inputs, deadline);
        if (usesWeth && nativeReserve != 0) {
            IPermit2AllowanceTransfer(permit2).approve(weth, uniswapUniversalRouter, 0, 0);
            IERC20(weth).forceApprove(permit2, 0);
            (uint160 allowance,,) = IPermit2AllowanceTransfer(permit2)
                .allowance(address(this), weth, uniswapUniversalRouter);
            if (allowance != 0 || IERC20(weth).allowance(address(this), permit2) != 0) {
                revert InvalidPlan();
            }
        }
        if (uniswapUniversalRouter.balance != nativeReserve) {
            revert BalanceMismatch(address(0), nativeReserve, uniswapUniversalRouter.balance);
        }
        returned = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            if (reserves[i] != 0) _transferExact(tokens[i], uniswapUniversalRouter, reserves[i]);
            _balance(tokens[i], uniswapUniversalRouter, reserves[i]);
            uint256 balance = IERC20(tokens[i]).balanceOf(entryExitRouter);
            if (balance < routerBefore[i] + minimum[i]) {
                revert InsufficientBalance(tokens[i], balance, routerBefore[i] + minimum[i]);
            }
            returned[i] = balance - routerBefore[i];
            _balance(tokens[i], address(this), baseline[i]);
        }
    }

    function _swap(Commands memory plan, Trade calldata trade, address recipient) private view {
        bytes calldata data = trade.data;
        if (data[0] == 0x03) {
            bytes calldata path = data[1:];
            uint256 hops = UniswapV3Path.hopCount(path);
            for (uint256 i; i < hops; ++i) {
                _v3Pool(
                    UniswapV3Path.tokenAt(path, i),
                    UniswapV3Path.tokenAt(path, i + 1),
                    UniswapV3Path.feeAt(path, i)
                );
            }
            _append(
                plan,
                0x00,
                abi.encode(
                    recipient,
                    trade.amountIn == type(uint256).max ? CONTRACT_BALANCE : trade.amountIn,
                    trade.minAmountOut,
                    path,
                    false,
                    new uint256[](0)
                )
            );
        } else {
            (address currencyIn, PathKey[] memory path) = abi.decode(data[1:], (address, PathKey[]));
            address current = currencyIn;
            for (uint256 i; i < path.length; ++i) {
                PathKey memory hop = path[i];
                address next = Currency.unwrap(hop.intermediateCurrency);
                if (
                    (hop.fee > 1_000_000 && hop.fee != 0x800000) || hop.tickSpacing <= 0
                        || hop.tickSpacing > 32_767 || hop.hookData.length > 1_024
                        || (address(hop.hooks) != address(0) && address(hop.hooks).code.length == 0)
                ) revert InvalidPath();
                (address a, address b) = current < next ? (current, next) : (next, current);
                (uint160 price,,,) = IUniswapV4StateView(uniswapV4StateView)
                    .getSlot0(keccak256(abi.encode(a, b, hop.fee, hop.tickSpacing, hop.hooks)));
                if (price == 0) revert UnauthenticatedPool();
                current = next;
            }
            if (
                trade.minAmountOut > type(uint128).max
                    || (trade.amountIn != type(uint256).max && trade.amountIn > type(uint128).max)
            ) revert InvalidPlan();
            if (currencyIn == address(0)) _append(plan, 0x0c, abi.encode(THIS, 0));
            bytes[] memory params = new bytes[](4);
            params[0] = abi.encode(
                currencyIn,
                trade.amountIn == type(uint256).max ? CONTRACT_BALANCE : trade.amountIn,
                false
            );
            params[1] = abi.encode(
                IV4Router.ExactInputParams(
                    Currency.wrap(currencyIn),
                    path,
                    new uint256[](0),
                    0,
                    uint128(trade.minAmountOut)
                )
            );
            // Native output must be wrapped before it can leave this batch.
            params[2] = abi.encode(current, current == address(0) ? THIS : recipient, uint256(0));
            params[3] = abi.encode(currencyIn, THIS, uint256(0));
            _append(plan, 0x10, abi.encode(hex"0b070e0e", params));
            if (currencyIn == address(0) || current == address(0)) {
                _append(plan, 0x0b, abi.encode(THIS, CONTRACT_BALANCE));
            }
        }
    }

    function _tokens(Trade[] calldata trades) private view returns (address[] memory tokens) {
        if (trades.length == 0 || trades.length > MAX_TRADES) revert InvalidPlan();
        tokens = new address[](MAX_TOKENS);
        uint256 count;
        for (uint256 i; i < trades.length; ++i) {
            Trade calldata trade = trades[i];
            if (
                trade.amountIn == 0 || trade.minAmountOut == 0
                    || trade.minAmountOut > type(uint128).max
                    || (trade.amountIn != type(uint256).max && trade.amountIn > type(uint128).max)
                    || trade.tokenIn == trade.tokenOut || trade.data.length == 0
            ) revert InvalidPlan();
            bytes calldata data = trade.data;
            address current;
            if (data[0] == 0x03) {
                bytes calldata path = data[1:];
                uint256 hops = UniswapV3Path.hopCount(path);
                if (hops == 0 || hops > MAX_HOPS) revert InvalidPath();
                current = UniswapV3Path.tokenAt(path, 0);
                if (current != trade.tokenIn) revert InvalidPath();
                count = _add(tokens, count, current);
                for (uint256 j; j < hops; ++j) {
                    address next = UniswapV3Path.tokenAt(path, j + 1);
                    if (next == current || UniswapV3Path.feeAt(path, j) == 0) revert InvalidPath();
                    count = _add(tokens, count, next);
                    current = next;
                }
            } else if (data[0] == 0x04) {
                (address currencyIn, PathKey[] memory path) =
                    abi.decode(data[1:], (address, PathKey[]));
                if (
                    path.length == 0 || path.length > MAX_HOPS
                        || _boundary(currencyIn) != trade.tokenIn
                ) revert InvalidPath();
                current = currencyIn;
                count = _add(tokens, count, _boundary(current));
                for (uint256 j; j < path.length; ++j) {
                    address next = Currency.unwrap(path[j].intermediateCurrency);
                    if (next == current) revert InvalidPath();
                    count = _add(tokens, count, _boundary(next));
                    current = next;
                }
                current = _boundary(current);
            } else {
                revert InvalidPath();
            }
            if (current != trade.tokenOut) revert InvalidPath();
        }
        assembly ("memory-safe") { mstore(tokens, count) }
    }

    function _v3Pool(address a, address b, uint24 fee) private view {
        if (a > b) (a, b) = (b, a);
        address expected = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            uniswapV3Factory,
                            keccak256(abi.encode(a, b, fee)),
                            v3PoolInitCodeHash
                        )
                    )
                )
            )
        );
        address pool = IUniswapV3Factory(uniswapV3Factory).getPool(a, b, fee);
        if (pool != expected || pool.code.length == 0) revert UnauthenticatedPool();
        IUniswapV3PoolImmutables p = IUniswapV3PoolImmutables(pool);
        if (p.factory() != uniswapV3Factory || p.token0() != a || p.token1() != b || p.fee() != fee)
        {
            revert UnauthenticatedPool();
        }
    }

    function _add(address[] memory tokens, uint256 count, address token)
        private
        view
        returns (uint256)
    {
        _contract(token);
        for (uint256 i; i < count; ++i) {
            if (tokens[i] == token) return count;
        }
        tokens[count] = token;
        return count + 1;
    }

    function _index(address[] calldata tokens, address token) private pure returns (uint256) {
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == token) return i;
        }
        revert InvalidPlan();
    }

    function _append(Commands memory plan, bytes1 command, bytes memory input) private pure {
        plan.codes[plan.count] = command;
        plan.inputs[plan.count++] = input;
    }

    function _boundary(address token) private view returns (address) {
        return token == address(0) ? weth : token;
    }

    function _contract(address account) private view {
        if (account.code.length == 0) revert InvalidDependency(account);
    }

    function _balance(address token, address account, uint256 expected) private view {
        uint256 observed = IERC20(token).balanceOf(account);
        if (observed != expected) revert BalanceMismatch(token, expected, observed);
    }

    function _transferExact(address token, address to, uint256 amount) private {
        uint256 before = IERC20(token).balanceOf(to);
        uint256 own = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, amount);
        _balance(token, to, before + amount);
        _balance(token, address(this), own - amount);
    }
}
