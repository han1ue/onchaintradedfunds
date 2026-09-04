// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20, IERC20Metadata, IOTFToken } from "./interfaces/IERC20.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4ImmutableState,
    IUniswapV4PoolManager,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4PoolKey,
    UniswapV4SwapParams
} from "./interfaces/IUniswapV4.sol";
import { V4PriceMath } from "./libraries/V4PriceMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Canonical OTF/WETH V4 bootstrap hook and permanent-liquidity lock.
/// @dev The after-swap hook only marks graduation ready. Permissionless finalization runs after the
///      PoolManager unlock, either later in the router's outer transaction or as a standalone call.
contract OTFLaunchManager {
    enum Phase {
        NotInitialized,
        BootstrapActive,
        GraduationReady,
        Graduated
    }

    uint256 public constant MAX_BOOTSTRAP_BUDGET = 150_000_000 ether;
    uint256 public constant PERMANENT_OTF_CAP = 50_000_000 ether;
    uint256 public constant REQUIRED_OTF_BALANCE = 200_000_000 ether;
    uint128 public constant BOOTSTRAP_LIQUIDITY = 31_819_848_221_821_239_732_818;
    uint128 public constant PERMANENT_LIQUIDITY = 21_213_049_526_830_492_717_974;
    uint24 public constant LP_FEE = 0;
    int24 public constant TICK_SPACING = 1;
    int24 public constant FULL_RANGE_LOWER_TICK = -887_272;
    int24 public constant FULL_RANGE_UPPER_TICK = 887_272;

    // The pool initializes at the exact 20 ETH reference-FDV price. The one-sided position starts at
    // the adjacent spacing-1 boundary; all position endpoints are derived from TickMath.
    int24 private constant DIRECT_INITIAL_TICK = -177_284;
    int24 private constant DIRECT_FINAL_TICK = -155_311;
    uint160 private constant DIRECT_INITIAL_SQRT_PRICE_X96 = 11_204_554_194_957_227_983_746_388;
    int24 private constant INVERSE_INITIAL_TICK = 177_284;
    int24 private constant INVERSE_FINAL_TICK = 155_311;
    uint160 private constant INVERSE_INITIAL_SQRT_PRICE_X96 =
        560_227_709_747_861_399_187_319_382_274_581;

    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint160 private constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 private constant REQUIRED_HOOK_FLAGS = BEFORE_INITIALIZE_FLAG | AFTER_SWAP_FLAG;
    bytes1 private constant MINT_POSITION_ACTION = 0x02;
    bytes1 private constant BURN_POSITION_ACTION = 0x03;
    bytes1 private constant SETTLE_PAIR_ACTION = 0x0d;
    bytes1 private constant TAKE_PAIR_ACTION = 0x11;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidTokenDecimals(address token, uint8 decimals);
    error InvalidHookAddress(address hook);
    error InvalidPhase(Phase expected, Phase actual);
    error InsufficientLaunchTokens(uint256 required, uint256 actual);
    error UnauthorizedPoolManager(address caller);
    error UnauthorizedInitializer(address initializer);
    error InvalidPool();
    error GraduationPriceNotReached(uint160 currentSqrtPriceX96, uint160 finalSqrtPriceX96);
    error BootstrapPriceOutOfBounds(uint160 currentSqrtPriceX96);
    error InvalidLaunchAmounts();
    error BootstrapDebitExceedsBudget(uint256 actualDebit);
    error InsufficientBootstrapWeth(uint256 required, uint256 received);
    error PermanentDebitInvalid(uint256 otfDebit, uint256 wethDebit);
    error ApprovalFailed(address token, address spender, uint256 amount);
    error Reentrancy();

    event BootstrapInitialized(
        bytes32 indexed poolId,
        uint256 indexed positionTokenId,
        int24 initialTick,
        int24 finalTick,
        uint128 liquidity
    );
    event GraduationReady(uint256 indexed blockNumber, int24 tick);
    event RemainingOtfBurned(uint256 amount);
    event Graduated(
        uint256 indexed blockNumber,
        uint64 timestamp,
        uint256 permanentPositionTokenId,
        uint256 otfLocked,
        uint256 wethLocked,
        uint128 liquidity
    );

    address public immutable otf;
    address public immutable weth;
    address public immutable poolManager;
    address public immutable stateView;
    address public immutable positionManager;
    address public immutable permit2;
    bool public immutable otfIsCurrency0;
    bytes32 public immutable poolId;
    int24 public immutable initialTick;
    int24 public immutable finalTick;
    uint160 public immutable initialSqrtPriceX96;
    uint160 public immutable finalSqrtPriceX96;

    UniswapV4PoolKey public poolKey;
    Phase public phase;
    uint128 public bootstrapLiquidity;
    uint128 public permanentLiquidity;
    uint256 public bootstrapPositionTokenId;
    uint256 public permanentPositionTokenId;
    uint256 public graduationReadyBlock;
    uint256 public graduationBlock;
    uint64 public graduationTimestamp;
    uint256 public bootstrapWethProceeds;
    uint256 public bootstrapWethPrincipal;
    uint256 public bootstrapOtfDeposited;
    uint256 public bootstrapOtfReturned;
    uint256 public permanentOtfLiquidity;
    uint256 public permanentWethLiquidity;
    uint256 public finalOtfBurned;
    bool private _entered;

    constructor(
        address otf_,
        address weth_,
        address poolManager_,
        address stateView_,
        address positionManager_,
        address permit2_
    ) {
        _requireContract(otf_);
        _requireContract(weth_);
        _requireContract(poolManager_);
        _requireContract(stateView_);
        _requireContract(positionManager_);
        _requireContract(permit2_);
        if (IERC20Metadata(otf_).decimals() != 18) {
            revert InvalidTokenDecimals(otf_, IERC20Metadata(otf_).decimals());
        }
        if (IERC20Metadata(weth_).decimals() != 18) {
            revert InvalidTokenDecimals(weth_, IERC20Metadata(weth_).decimals());
        }
        if (IUniswapV4ImmutableState(stateView_).poolManager() != poolManager_) {
            revert InvalidDependency(stateView_);
        }
        if (IUniswapV4ImmutableState(positionManager_).poolManager() != poolManager_) {
            revert InvalidDependency(positionManager_);
        }

        otf = otf_;
        weth = weth_;
        poolManager = poolManager_;
        stateView = stateView_;
        positionManager = positionManager_;
        permit2 = permit2_;
        otfIsCurrency0 = otf_ < weth_;
        (address currency0, address currency1) = otf_ < weth_ ? (otf_, weth_) : (weth_, otf_);
        poolKey = UniswapV4PoolKey(currency0, currency1, LP_FEE, TICK_SPACING, address(this));
        poolId = keccak256(abi.encode(currency0, currency1, LP_FEE, TICK_SPACING, address(this)));

        if (otf_ < weth_) {
            initialTick = DIRECT_INITIAL_TICK;
            finalTick = DIRECT_FINAL_TICK;
            initialSqrtPriceX96 = DIRECT_INITIAL_SQRT_PRICE_X96;
            finalSqrtPriceX96 = TickMath.getSqrtPriceAtTick(DIRECT_FINAL_TICK);
        } else {
            initialTick = INVERSE_INITIAL_TICK;
            finalTick = INVERSE_FINAL_TICK;
            initialSqrtPriceX96 = INVERSE_INITIAL_SQRT_PRICE_X96;
            finalSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INVERSE_FINAL_TICK);
        }
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function hookPermissionsValid() public view returns (bool) {
        return uint160(address(this)) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS;
    }

    /// @notice Uniswap V4 beforeInitialize hook. PoolManager skips this callback for hook self-calls.
    function beforeInitialize(address initializer, UniswapV4PoolKey calldata, uint160)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (initializer != address(this)) revert UnauthorizedInitializer(initializer);
        return this.beforeInitialize.selector;
    }

    function initializeLaunch() external nonReentrant {
        if (phase != Phase.NotInitialized) revert InvalidPhase(Phase.NotInitialized, phase);
        if (!hookPermissionsValid()) revert InvalidHookAddress(address(this));
        uint256 otfBalance = IERC20(otf).balanceOf(address(this));
        if (otfBalance < REQUIRED_OTF_BALANCE) {
            revert InsufficientLaunchTokens(REQUIRED_OTF_BALANCE, otfBalance);
        }
        IUniswapV4PoolManager(poolManager).initialize(poolKey, initialSqrtPriceX96);
        (
            uint256 expectedBootstrapOtf,
            uint256 expectedBootstrapWeth,
            uint256 permanentOtf,
            uint256 permanentWeth
        ) = derivedLaunchAmounts();
        if (
            expectedBootstrapOtf > MAX_BOOTSTRAP_BUDGET || permanentOtf > PERMANENT_OTF_CAP
                || expectedBootstrapWeth != permanentWeth
        ) revert InvalidLaunchAmounts();
        bootstrapWethPrincipal = expectedBootstrapWeth;
        bootstrapLiquidity = BOOTSTRAP_LIQUIDITY;
        uint256 otfBefore = IERC20(otf).balanceOf(address(this));
        bootstrapPositionTokenId = _mintPosition(
            otfIsCurrency0 ? initialTick : finalTick,
            otfIsCurrency0 ? finalTick : initialTick,
            bootstrapLiquidity,
            otfIsCurrency0 ? MAX_BOOTSTRAP_BUDGET : 0,
            otfIsCurrency0 ? 0 : MAX_BOOTSTRAP_BUDGET
        );
        bootstrapOtfDeposited = otfBefore - IERC20(otf).balanceOf(address(this));
        if (bootstrapOtfDeposited > MAX_BOOTSTRAP_BUDGET) {
            revert BootstrapDebitExceedsBudget(bootstrapOtfDeposited);
        }
        phase = Phase.BootstrapActive;
        emit BootstrapInitialized(
            poolId, bootstrapPositionTokenId, initialTick, finalTick, bootstrapLiquidity
        );
    }

    /// @notice Uniswap V4 afterSwap hook. The return delta is always zero.
    function afterSwap(
        address,
        UniswapV4PoolKey calldata key,
        UniswapV4SwapParams calldata,
        int256,
        bytes calldata
    ) external returns (bytes4, int128) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (_poolId(key) != poolId) revert InvalidPool();
        Phase currentPhase = phase;
        if (currentPhase == Phase.Graduated) return (this.afterSwap.selector, 0);
        if (currentPhase == Phase.GraduationReady) {
            revert InvalidPhase(Phase.BootstrapActive, currentPhase);
        }
        if (currentPhase != Phase.BootstrapActive) {
            revert InvalidPhase(Phase.BootstrapActive, currentPhase);
        }
        (uint160 sqrtPriceX96, int24 tick,,) = IUniswapV4StateView(stateView).getSlot0(poolId);
        (uint160 lowerSqrtPriceX96, uint160 upperSqrtPriceX96) = bootstrapSqrtPriceBounds();
        if (sqrtPriceX96 < lowerSqrtPriceX96 || sqrtPriceX96 > upperSqrtPriceX96) {
            revert BootstrapPriceOutOfBounds(sqrtPriceX96);
        }
        if (sqrtPriceX96 == finalSqrtPriceX96) {
            phase = Phase.GraduationReady;
            graduationReadyBlock = block.number;
            emit GraduationReady(block.number, tick);
        }
        return (this.afterSwap.selector, 0);
    }

    function finalizeGraduation() external nonReentrant {
        if (phase != Phase.GraduationReady) {
            revert InvalidPhase(Phase.GraduationReady, phase);
        }
        (uint160 currentSqrtPriceX96,,,) = IUniswapV4StateView(stateView).getSlot0(poolId);
        if (currentSqrtPriceX96 != finalSqrtPriceX96) {
            revert GraduationPriceNotReached(currentSqrtPriceX96, finalSqrtPriceX96);
        }
        (
            ,
            uint256 expectedBootstrapWeth,
            uint256 expectedPermanentOtf,
            uint256 expectedPermanentWeth
        ) = derivedLaunchAmounts();

        uint256 otfBefore = IERC20(otf).balanceOf(address(this));
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        _burnBootstrapPosition();
        uint256 otfAfter = IERC20(otf).balanceOf(address(this));
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        bootstrapOtfReturned = otfAfter - otfBefore;
        bootstrapWethProceeds = wethAfter - wethBefore;
        if (bootstrapWethProceeds < expectedBootstrapWeth) {
            revert InsufficientBootstrapWeth(expectedBootstrapWeth, bootstrapWethProceeds);
        }
        permanentLiquidity = PERMANENT_LIQUIDITY;
        otfBefore = IERC20(otf).balanceOf(address(this));
        wethBefore = IERC20(weth).balanceOf(address(this));
        permanentPositionTokenId = _mintPosition(
            FULL_RANGE_LOWER_TICK,
            FULL_RANGE_UPPER_TICK,
            permanentLiquidity,
            otfIsCurrency0 ? PERMANENT_OTF_CAP : expectedPermanentWeth,
            otfIsCurrency0 ? expectedPermanentWeth : PERMANENT_OTF_CAP
        );
        permanentOtfLiquidity = otfBefore - IERC20(otf).balanceOf(address(this));
        permanentWethLiquidity = wethBefore - IERC20(weth).balanceOf(address(this));
        if (
            permanentOtfLiquidity > PERMANENT_OTF_CAP
                || permanentWethLiquidity != expectedPermanentWeth
                || expectedPermanentOtf > PERMANENT_OTF_CAP
        ) revert PermanentDebitInvalid(permanentOtfLiquidity, permanentWethLiquidity);

        finalOtfBurned = IERC20(otf).balanceOf(address(this));
        IOTFToken(otf).burn(finalOtfBurned);
        emit RemainingOtfBurned(finalOtfBurned);
        phase = Phase.Graduated;
        graduationBlock = block.number;
        graduationTimestamp = uint64(block.timestamp);
        emit Graduated(
            block.number,
            graduationTimestamp,
            permanentPositionTokenId,
            permanentOtfLiquidity,
            permanentWethLiquidity,
            permanentLiquidity
        );
    }

    function currentPoolState() public view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick,,) = IUniswapV4StateView(stateView).getSlot0(poolId);
    }

    function currentOtfPriceWethWad() public view returns (uint256) {
        (uint160 sqrtPriceX96,) = currentPoolState();
        return V4PriceMath.otfPriceWethWad(sqrtPriceX96, otfIsCurrency0);
    }

    function initialOtfPriceWethWad() external view returns (uint256) {
        return V4PriceMath.otfPriceWethWad(initialSqrtPriceX96, otfIsCurrency0);
    }

    function finalOtfPriceWethWad() external view returns (uint256) {
        return V4PriceMath.otfPriceWethWad(finalSqrtPriceX96, otfIsCurrency0);
    }

    function currentLaunchReferenceFdvWeth() external view returns (uint256) {
        return Math.mulDiv(currentOtfPriceWethWad(), IOTFToken(otf).MAX_SUPPLY(), 1e18);
    }

    function bootstrapSqrtPriceBounds()
        public
        view
        returns (uint160 lowerSqrtPriceX96, uint160 upperSqrtPriceX96)
    {
        lowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(otfIsCurrency0 ? initialTick : finalTick);
        upperSqrtPriceX96 = TickMath.getSqrtPriceAtTick(otfIsCurrency0 ? finalTick : initialTick);
    }

    function derivedLaunchAmounts()
        public
        view
        returns (
            uint256 bootstrapOtf,
            uint256 bootstrapWeth,
            uint256 permanentOtf,
            uint256 permanentWeth
        )
    {
        (uint160 bootstrapLower, uint160 bootstrapUpper) = bootstrapSqrtPriceBounds();
        uint160 fullRangeLower = TickMath.getSqrtPriceAtTick(FULL_RANGE_LOWER_TICK);
        uint160 fullRangeUpper = TickMath.getSqrtPriceAtTick(FULL_RANGE_UPPER_TICK);
        if (otfIsCurrency0) {
            bootstrapOtf = SqrtPriceMath.getAmount0Delta(
                bootstrapLower, bootstrapUpper, BOOTSTRAP_LIQUIDITY, true
            );
            bootstrapWeth = SqrtPriceMath.getAmount1Delta(
                bootstrapLower, bootstrapUpper, BOOTSTRAP_LIQUIDITY, false
            );
            permanentOtf = SqrtPriceMath.getAmount0Delta(
                finalSqrtPriceX96, fullRangeUpper, PERMANENT_LIQUIDITY, true
            );
            permanentWeth = SqrtPriceMath.getAmount1Delta(
                fullRangeLower, finalSqrtPriceX96, PERMANENT_LIQUIDITY, true
            );
        } else {
            bootstrapOtf = SqrtPriceMath.getAmount1Delta(
                bootstrapLower, bootstrapUpper, BOOTSTRAP_LIQUIDITY, true
            );
            bootstrapWeth = SqrtPriceMath.getAmount0Delta(
                bootstrapLower, bootstrapUpper, BOOTSTRAP_LIQUIDITY, false
            );
            permanentOtf = SqrtPriceMath.getAmount1Delta(
                fullRangeLower, finalSqrtPriceX96, PERMANENT_LIQUIDITY, true
            );
            permanentWeth = SqrtPriceMath.getAmount0Delta(
                finalSqrtPriceX96, fullRangeUpper, PERMANENT_LIQUIDITY, true
            );
        }
    }

    function bootstrapProgress()
        external
        view
        returns (uint256 progressBps, uint256 otfSold, uint256 otfRemaining, uint256 wethRaised)
    {
        if (phase == Phase.NotInitialized) return (0, 0, 0, 0);
        if (phase == Phase.Graduated) {
            return (10_000, bootstrapOtfDeposited, 0, bootstrapWethPrincipal);
        }
        (uint160 sqrtPriceX96,) = currentPoolState();
        (uint160 lowerSqrtPriceX96, uint160 upperSqrtPriceX96) = bootstrapSqrtPriceBounds();
        uint160 startSqrtPriceX96 = otfIsCurrency0 ? lowerSqrtPriceX96 : upperSqrtPriceX96;
        uint256 distance = otfIsCurrency0
            ? uint256(upperSqrtPriceX96 - startSqrtPriceX96)
            : uint256(startSqrtPriceX96 - lowerSqrtPriceX96);
        uint256 traveled;
        if (otfIsCurrency0) {
            traveled = sqrtPriceX96 <= startSqrtPriceX96
                ? 0
                : sqrtPriceX96 >= upperSqrtPriceX96
                    ? distance
                    : uint256(sqrtPriceX96 - startSqrtPriceX96);
        } else {
            traveled = sqrtPriceX96 >= startSqrtPriceX96
                ? 0
                : sqrtPriceX96 <= lowerSqrtPriceX96
                    ? distance
                    : uint256(startSqrtPriceX96 - sqrtPriceX96);
        }
        progressBps = traveled * 10_000 / distance;
        uint256 amount0;
        uint256 amount1;
        if (sqrtPriceX96 <= lowerSqrtPriceX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                lowerSqrtPriceX96, upperSqrtPriceX96, bootstrapLiquidity, false
            );
        } else if (sqrtPriceX96 < upperSqrtPriceX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                sqrtPriceX96, upperSqrtPriceX96, bootstrapLiquidity, false
            );
            amount1 = SqrtPriceMath.getAmount1Delta(
                lowerSqrtPriceX96, sqrtPriceX96, bootstrapLiquidity, false
            );
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(
                lowerSqrtPriceX96, upperSqrtPriceX96, bootstrapLiquidity, false
            );
        }
        otfRemaining = otfIsCurrency0 ? amount0 : amount1;
        if (otfRemaining > bootstrapOtfDeposited) otfRemaining = bootstrapOtfDeposited;
        otfSold = bootstrapOtfDeposited - otfRemaining;
        wethRaised = otfIsCurrency0 ? amount1 : amount0;
    }

    function lockedDustBalances() external view returns (uint256 otfDust, uint256 wethDust) {
        otfDust = IERC20(otf).balanceOf(address(this));
        wethDust = IERC20(weth).balanceOf(address(this));
    }

    function _mintPosition(
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) private returns (uint256 tokenId) {
        tokenId = IUniswapV4PositionManager(positionManager).nextTokenId();
        _setPositionManagerAllowance(poolKey.currency0, amount0Max);
        _setPositionManagerAllowance(poolKey.currency1, amount1Max);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            poolKey,
            tickLower,
            tickUpper,
            uint256(liquidity),
            // _setPositionManagerAllowance bounds both maxima to uint128 first.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128(amount0Max),
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128(amount1Max),
            address(this),
            bytes("")
        );
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        IUniswapV4PositionManager(positionManager)
            .modifyLiquidities(
                abi.encode(abi.encodePacked(MINT_POSITION_ACTION, SETTLE_PAIR_ACTION), params),
                block.timestamp
            );
        _setPositionManagerAllowance(poolKey.currency0, 0);
        _setPositionManagerAllowance(poolKey.currency1, 0);
    }

    function _burnBootstrapPosition() private {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(bootstrapPositionTokenId, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));
        IUniswapV4PositionManager(positionManager)
            .modifyLiquidities(
                abi.encode(abi.encodePacked(BURN_POSITION_ACTION, TAKE_PAIR_ACTION), params),
                block.timestamp
            );
    }

    function _setPositionManagerAllowance(address token, uint256 amount) private {
        if (amount > type(uint160).max || amount > type(uint128).max) {
            revert ApprovalFailed(token, positionManager, amount);
        }
        if (!IERC20(token).approve(permit2, amount)) {
            revert ApprovalFailed(token, permit2, amount);
        }
        // amount is explicitly bounded to uint128 above, so it also fits uint160.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 permitAmount = uint160(amount);
        IPermit2AllowanceTransfer(permit2)
            .approve(
                token, positionManager, permitAmount, amount == 0 ? 0 : uint48(block.timestamp + 1)
            );
    }

    function _poolId(UniswapV4PoolKey calldata key) private pure returns (bytes32) {
        return
            keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
