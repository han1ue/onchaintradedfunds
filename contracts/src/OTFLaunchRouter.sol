// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWETH} from "./interfaces/IWETH.sol";
import {IUniswapV4PoolManager, UniswapV4PoolKey, UniswapV4SwapParams} from "./interfaces/IUniswapV4.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

interface ILaunchManagerRouter {
    function otf() external view returns (address);
    function weth() external view returns (address);
    function poolManager() external view returns (address);
    function otfIsCurrency0() external view returns (bool);
    function finalSqrtPriceX96() external view returns (uint160);
    function phase() external view returns (uint8);
    function bootstrapSqrtPriceBounds() external view returns (uint160 lowerSqrtPriceX96, uint160 upperSqrtPriceX96);
    function poolKey()
        external
        view
        returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
    function finalizeGraduation() external;
}

/// @notice Boundary-aware OTF/WETH bootstrap swaps with exact-input partial fills.
contract OTFLaunchRouter {
    using SafeTransferLib for address;

    uint8 private constant BOOTSTRAP_ACTIVE = 1;
    uint8 private constant GRADUATION_READY = 2;

    struct CallbackData {
        address payer;
        address recipient;
        uint256 amountInMaximum;
        uint256 amountOutMinimum;
        bool buyOtf;
        bool nativeInput;
    }

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidPhase(uint8 actual);
    error DeadlinePassed(uint256 deadline);
    error InvalidAmount();
    error UnauthorizedPoolManager(address caller);
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error RefundFailed();
    error Reentrancy();

    event BootstrapSwap(
        address indexed payer, address indexed recipient, bool indexed buyOtf, uint256 amountIn, uint256 amountOut
    );

    address public immutable launchManager;
    address public immutable poolManager;
    address public immutable otf;
    address public immutable weth;
    bool public immutable otfIsCurrency0;
    UniswapV4PoolKey public poolKey;
    bool private _entered;

    constructor(address launchManager_) {
        if (launchManager_ == address(0)) revert ZeroAddress();
        if (launchManager_.code.length == 0) revert InvalidDependency(launchManager_);
        ILaunchManagerRouter launch = ILaunchManagerRouter(launchManager_);
        address poolManager_ = launch.poolManager();
        address otf_ = launch.otf();
        address weth_ = launch.weth();
        if (poolManager_.code.length == 0) revert InvalidDependency(poolManager_);
        if (otf_.code.length == 0) revert InvalidDependency(otf_);
        if (weth_.code.length == 0) revert InvalidDependency(weth_);
        (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) = launch.poolKey();
        bool otfIsCurrency0_ = launch.otfIsCurrency0();
        if (
            hooks != launchManager_ || currency0 != (otfIsCurrency0_ ? otf_ : weth_)
                || currency1 != (otfIsCurrency0_ ? weth_ : otf_)
        ) revert InvalidDependency(launchManager_);

        launchManager = launchManager_;
        poolManager = poolManager_;
        otf = otf_;
        weth = weth_;
        otfIsCurrency0 = otfIsCurrency0_;
        poolKey = UniswapV4PoolKey(currency0, currency1, fee, tickSpacing, hooks);
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function buyOtfWithWeth(uint256 amountInMaximum, uint256 amountOutMinimum, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut) =
            _swap(CallbackData(msg.sender, recipient, amountInMaximum, amountOutMinimum, true, false), deadline);
    }

    function buyOtfWithEth(uint256 amountOutMinimum, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut) =
            _swap(CallbackData(msg.sender, recipient, msg.value, amountOutMinimum, true, true), deadline);
        uint256 refund = msg.value - amountIn;
        if (refund != 0) {
            (bool success,) = msg.sender.call{value: refund}("");
            if (!success) revert RefundFailed();
        }
    }

    function sellOtfForWeth(uint256 amountInMaximum, uint256 amountOutMinimum, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut) =
            _swap(CallbackData(msg.sender, recipient, amountInMaximum, amountOutMinimum, false, false), deadline);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        CallbackData memory callback = abi.decode(data, (CallbackData));
        bool zeroForOne = callback.buyOtf != otfIsCurrency0;
        uint160 sqrtPriceLimitX96;
        if (callback.buyOtf) {
            sqrtPriceLimitX96 = ILaunchManagerRouter(launchManager).finalSqrtPriceX96();
        } else {
            (uint160 lowerSqrtPriceX96, uint160 upperSqrtPriceX96) =
                ILaunchManagerRouter(launchManager).bootstrapSqrtPriceBounds();
            sqrtPriceLimitX96 = otfIsCurrency0 ? lowerSqrtPriceX96 : upperSqrtPriceX96;
        }

        int256 delta = IUniswapV4PoolManager(poolManager)
            .swap(
                poolKey,
                UniswapV4SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(callback.amountInMaximum),
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
                bytes("")
            );
        (int128 amount0, int128 amount1) = _unpackDelta(delta);
        int128 inputDelta = zeroForOne ? amount0 : amount1;
        int128 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta >= 0 || outputDelta <= 0) revert InvalidAmount();
        // Input is capped below int128.max and both signed deltas have been checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountIn = uint256(uint128(-inputDelta));
        // A positive int128 always fits uint128 and uint256.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountOut = uint256(uint128(outputDelta));
        if (amountOut < callback.amountOutMinimum) {
            revert MinimumOutputNotMet(callback.amountOutMinimum, amountOut);
        }

        address inputToken = callback.buyOtf ? weth : otf;
        address outputToken = callback.buyOtf ? otf : weth;
        IUniswapV4PoolManager(poolManager).sync(inputToken);
        if (callback.nativeInput) {
            IWETH(weth).deposit{value: amountIn}();
            weth.safeTransfer(poolManager, amountIn);
        } else {
            inputToken.safeTransferFrom(callback.payer, poolManager, amountIn);
        }
        IUniswapV4PoolManager(poolManager).settle();
        IUniswapV4PoolManager(poolManager).take(outputToken, callback.recipient, amountOut);
        return abi.encode(amountIn, amountOut);
    }

    function _swap(CallbackData memory callback, uint256 deadline)
        private
        returns (uint256 amountIn, uint256 amountOut)
    {
        // User-supplied swap deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlinePassed(deadline);
        if (callback.recipient == address(0)) revert ZeroAddress();
        if (callback.amountInMaximum == 0 || callback.amountInMaximum > uint256(uint128(type(int128).max))) {
            revert InvalidAmount();
        }
        uint8 currentPhase = ILaunchManagerRouter(launchManager).phase();
        if (currentPhase != BOOTSTRAP_ACTIVE) revert InvalidPhase(currentPhase);
        (amountIn, amountOut) =
            abi.decode(IUniswapV4PoolManager(poolManager).unlock(abi.encode(callback)), (uint256, uint256));
        if (ILaunchManagerRouter(launchManager).phase() == GRADUATION_READY) {
            ILaunchManagerRouter(launchManager).finalizeGraduation();
        }
        emit BootstrapSwap(callback.payer, callback.recipient, callback.buyOtf, amountIn, amountOut);
    }

    function _unpackDelta(int256 delta) private pure returns (int128 amount0, int128 amount1) {
        assembly ("memory-safe") {
            amount0 := sar(128, delta)
            amount1 := signextend(15, delta)
        }
    }
}
