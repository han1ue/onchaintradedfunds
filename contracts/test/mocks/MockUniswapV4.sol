// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IPermit2AllowanceTransfer,
    IUniswapUniversalRouter,
    IUniswapV4StateView,
    UniswapV4ExactInputParams,
    UniswapV4PathKey
} from "../../src/interfaces/IUniswapV4.sol";
import { SafeTransferLib } from "../../src/libraries/SafeTransferLib.sol";

contract MockUniswapV4PoolManager { }

contract MockPermit2 is IPermit2AllowanceTransfer {
    using SafeTransferLib for address;

    struct StoredAllowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    mapping(
        address user => mapping(address token => mapping(address spender => StoredAllowance))
    ) private _allowances;

    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce)
    {
        StoredAllowance memory value = _allowances[user][token][spender];
        return (value.amount, value.expiration, value.nonce);
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        StoredAllowance storage value = _allowances[msg.sender][token][spender];
        value.amount = amount;
        value.expiration = expiration == 0 ? uint48(block.timestamp) : expiration;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        StoredAllowance storage value = _allowances[from][token][msg.sender];
        require(value.amount >= amount, "PERMIT2_ALLOWANCE");
        require(value.expiration >= block.timestamp, "PERMIT2_EXPIRED");
        value.amount -= amount;
        token.safeTransferFrom(from, to, amount);
    }
}

contract MockUniswapV4StateView is IUniswapV4StateView {
    address public poolManager;
    mapping(bytes32 poolId => uint160 sqrtPriceX96) public sqrtPrices;
    mapping(bytes32 poolId => int24 tick) public ticks;

    constructor(address poolManager_) {
        poolManager = poolManager_;
    }

    function setPoolManager(address poolManager_) external {
        poolManager = poolManager_;
    }

    function setPool(bytes32 poolId, uint160 sqrtPriceX96) external {
        sqrtPrices[poolId] = sqrtPriceX96;
    }

    function setPoolState(bytes32 poolId, uint160 sqrtPriceX96, int24 tick_) external {
        sqrtPrices[poolId] = sqrtPriceX96;
        ticks[poolId] = tick_;
    }

    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        return (sqrtPrices[poolId], ticks[poolId], 0, 0);
    }
}

contract MockUniswapUniversalRouter is IUniswapUniversalRouter {
    using SafeTransferLib for address;

    address public poolManager;
    IPermit2AllowanceTransfer public immutable permit2;
    uint256 public outputMultiplier = 1;
    bool public skipInputPull;
    address public lastIntermediateCurrency;
    uint24 public lastFee;
    int24 public lastTickSpacing;
    address public lastHooks;

    constructor(address poolManager_, address permit2_) {
        poolManager = poolManager_;
        permit2 = IPermit2AllowanceTransfer(permit2_);
    }

    function setPoolManager(address poolManager_) external {
        poolManager = poolManager_;
    }

    function setOutputMultiplier(uint256 multiplier) external {
        require(multiplier != 0, "ZERO_MULTIPLIER");
        outputMultiplier = multiplier;
    }

    function setSkipInputPull(bool skip) external {
        skipInputPull = skip;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
    {
        require(deadline >= block.timestamp, "DEADLINE");
        require(keccak256(commands) == keccak256(hex"10") && inputs.length == 1, "COMMAND");
        (bytes memory actions, bytes[] memory actionParams) =
            abi.decode(inputs[0], (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"070c0f") && actionParams.length == 3, "ACTIONS");

        UniswapV4ExactInputParams memory params =
            abi.decode(actionParams[0], (UniswapV4ExactInputParams));
        require(params.minHopPriceX36.length == 0, "HOP_PRICES");
        (address settleToken, uint256 settleMaximum) =
            abi.decode(actionParams[1], (address, uint256));
        (address takeToken, uint256 takeMinimum) = abi.decode(actionParams[2], (address, uint256));
        require(params.path.length != 0, "PATH");
        UniswapV4PathKey memory finalKey = params.path[params.path.length - 1];
        lastIntermediateCurrency = finalKey.intermediateCurrency;
        lastFee = finalKey.fee;
        lastTickSpacing = finalKey.tickSpacing;
        lastHooks = address(finalKey.hooks);
        require(settleToken == params.currencyIn && settleMaximum == params.amountIn, "SETTLE");
        require(
            takeToken == params.path[params.path.length - 1].intermediateCurrency
                && takeMinimum == params.amountOutMinimum,
            "TAKE"
        );

        if (!skipInputPull) {
            permit2.transferFrom(msg.sender, address(this), params.amountIn, settleToken);
        }
        uint256 amountOut = uint256(params.amountIn) * outputMultiplier;
        require(amountOut >= params.amountOutMinimum, "SLIPPAGE");
        takeToken.safeTransfer(msg.sender, amountOut);
    }
}
