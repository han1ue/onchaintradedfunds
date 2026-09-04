// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapUniversalRouter,
    IUniswapV4ImmutableState,
    UniswapV4ExactInputParams,
    UniswapV4PathKey
} from "./interfaces/IUniswapV4.sol";
import {
    BasketRedeemRequest,
    FeeShareSwapRequest,
    OTFEntryExitRouter,
    SwapLeg
} from "./OTFEntryExitRouter.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IOTFBurnable is IERC20 {
    function burn(uint256 amount) external;
}

interface IBuybackLaunchManager {
    function otf() external view returns (address);
    function weth() external view returns (address);
    function poolManager() external view returns (address);
}

interface IBuybackFactory {
    function buybackCollector() external view returns (address);
    function entryExitRouter() external view returns (address);
    function isVault(address vault) external view returns (bool);
}

interface IBuybackVault is IERC20 {
    function checkpointFees() external returns (uint256 totalFeeShares);
    function expenseBeneficiary() external view returns (address);
}

/// @notice Settles fund fees into creator WETH plus an atomic OTF buyback and burn.
contract BuybackCollector {
    using SafeTransferLib for address;

    bytes1 private constant V4_SWAP_COMMAND = ProtocolConstants.UNISWAP_V4_SWAP_COMMAND;
    bytes1 private constant SWAP_EXACT_IN_ACTION =
        ProtocolConstants.UNISWAP_V4_SWAP_EXACT_IN_ACTION;
    bytes1 private constant SETTLE_ALL_ACTION = ProtocolConstants.UNISWAP_V4_SETTLE_ALL_ACTION;
    bytes1 private constant TAKE_ALL_ACTION = ProtocolConstants.UNISWAP_V4_TAKE_ALL_ACTION;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error InvalidAmount();
    error NothingToSettle(address vault);
    error DeadlineExpired(uint256 deadline);
    error UnauthorizedBeneficiary(address caller, address beneficiary);
    error UnauthorizedVault(address caller);
    error UnapprovedAdapter(address adapter);
    error InvalidRouteToken(uint256 leg, address tokenIn, address tokenOut);
    error ApprovalFailed(address token, address spender, uint256 amount);
    error BalanceDeltaMismatch(address token, uint256 expected, uint256 observed);
    error MinimumOutputNotMet(address token, uint256 minimum, uint256 actual);
    error Reentrancy();
    error FactoryAlreadyConfigured();
    error FactoryNotConfigured();
    error UnauthorizedRouterConfigurator(address caller);

    struct VaultFeeAccount {
        uint256 creatorFeeShares;
        uint256 buybackFeeShares;
    }

    struct PendingSettlement {
        uint256 creatorFeeShares;
        uint256 buybackFeeShares;
        uint256 totalFeeShares;
        address beneficiary;
    }

    event FeeSharesRecorded(
        address indexed vault,
        uint256 creatorFeeShares,
        uint256 buybackFeeShares,
        uint256 pendingCreatorFeeShares,
        uint256 pendingBuybackFeeShares
    );
    event FeesSettled(
        address indexed vault,
        address indexed expenseBeneficiary,
        bool sharesRedeemed,
        uint256 creatorFeeShares,
        uint256 buybackFeeShares,
        uint256 creatorWeth,
        uint256 buybackWeth,
        uint256 otfBurned
    );
    event FactoryConfigured(address indexed factory);

    address public immutable routerConfigurator;
    address public immutable launchManager;
    address public immutable otf;
    address public immutable weth;
    address public immutable universalRouter;
    address public immutable permit2;
    address public immutable poolManager;
    address public factory;
    mapping(address => VaultFeeAccount) public feeAccounts;
    bool private _entered;

    constructor(address launchManager_, address universalRouter_, address permit2_) {
        _requireContract(launchManager_);
        _requireContract(universalRouter_);
        _requireContract(permit2_);
        IBuybackLaunchManager launch = IBuybackLaunchManager(launchManager_);
        address otf_ = launch.otf();
        address weth_ = launch.weth();
        address poolManager_ = launch.poolManager();
        _requireContract(otf_);
        _requireContract(weth_);
        _requireContract(poolManager_);
        if (IUniswapV4ImmutableState(universalRouter_).poolManager() != poolManager_) {
            revert InvalidDependency(universalRouter_);
        }
        routerConfigurator = msg.sender;
        launchManager = launchManager_;
        otf = otf_;
        weth = weth_;
        universalRouter = universalRouter_;
        permit2 = permit2_;
        poolManager = poolManager_;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function configureFactory(address factory_) external {
        if (msg.sender != routerConfigurator) {
            revert UnauthorizedRouterConfigurator(msg.sender);
        }
        if (factory != address(0)) revert FactoryAlreadyConfigured();
        _requireContract(factory_);
        address observedCollector;
        try IBuybackFactory(factory_).buybackCollector() returns (address value) {
            observedCollector = value;
        } catch {
            revert InvalidDependency(factory_);
        }
        if (observedCollector != address(this)) revert InvalidDependency(factory_);
        factory = factory_;
        emit FactoryConfigured(factory_);
    }

    function recordFeeShares(uint256 creatorFeeShares, uint256 buybackFeeShares) external {
        address vault = msg.sender;
        VaultFeeAccount storage account = feeAccounts[vault];
        if (!_isFactoryVault(vault)) {
            revert UnauthorizedVault(vault);
        }
        if (creatorFeeShares + buybackFeeShares == 0) revert InvalidAmount();
        account.creatorFeeShares += creatorFeeShares;
        account.buybackFeeShares += buybackFeeShares;
        emit FeeSharesRecorded(
            vault,
            creatorFeeShares,
            buybackFeeShares,
            account.creatorFeeShares,
            account.buybackFeeShares
        );
    }

    function settleFeesViaRedemption(
        address vault,
        uint256[] calldata minBasketAmounts,
        uint256 skipMask,
        SwapLeg[] calldata legs,
        uint256 minWethOut,
        uint256 minOtfOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 creatorWeth, uint256 buybackWeth, uint256 otfBurned) {
        address router = _entryExitRouter();
        _requireContract(router);
        _validateLegs(router, legs, vault);
        PendingSettlement memory pending = _consumePending(vault, minWethOut, minOtfOut, deadline);

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        _approveExact(vault, router, pending.totalFeeShares);
        (uint256 reportedWeth,,) = OTFEntryExitRouter(payable(router))
            .redeemToToken(
                BasketRedeemRequest({
                vault: vault,
                outputToken: weth,
                shares: pending.totalFeeShares,
                minAmountOut: minWethOut,
                skipMask: skipMask,
                deadline: deadline
            }),
                minBasketAmounts,
                legs
            );
        _approveExact(vault, router, 0);
        uint256 wethOut = _checkWethOutput(wethBefore, reportedWeth, minWethOut);
        return _finishSettlement(vault, pending, wethOut, minOtfOut, deadline, true);
    }

    function settleFeesViaShareSale(
        address vault,
        SwapLeg[] calldata legs,
        uint256 minWethOut,
        uint256 minOtfOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 creatorWeth, uint256 buybackWeth, uint256 otfBurned) {
        address router = _entryExitRouter();
        _requireContract(router);
        _validateLegs(router, legs, address(0));
        PendingSettlement memory pending = _consumePending(vault, minWethOut, minOtfOut, deadline);

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        _approveExact(vault, router, pending.totalFeeShares);
        uint256 reportedWeth = OTFEntryExitRouter(payable(router))
            .swapFeeSharesToWeth(
                FeeShareSwapRequest({
                vault: vault,
                shares: pending.totalFeeShares,
                minAmountOut: minWethOut,
                deadline: deadline
            }),
                legs
            );
        _approveExact(vault, router, 0);
        uint256 wethOut = _checkWethOutput(wethBefore, reportedWeth, minWethOut);
        return _finishSettlement(vault, pending, wethOut, minOtfOut, deadline, false);
    }

    function _consumePending(address vault, uint256 minWethOut, uint256 minOtfOut, uint256 deadline)
        private
        returns (PendingSettlement memory pending)
    {
        // Deadlines are intentionally enforced against the current transaction timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (
            minWethOut == 0 || minOtfOut == 0 || minWethOut > type(uint128).max
                || minOtfOut > type(uint128).max
        ) {
            revert InvalidAmount();
        }
        VaultFeeAccount storage account = feeAccounts[vault];
        if (!_isFactoryVault(vault)) revert InvalidVault(vault);
        pending.beneficiary = IBuybackVault(vault).expenseBeneficiary();
        if (pending.beneficiary == address(0)) revert InvalidVault(vault);
        if (msg.sender != pending.beneficiary) {
            revert UnauthorizedBeneficiary(msg.sender, pending.beneficiary);
        }

        IBuybackVault(vault).checkpointFees();
        pending.creatorFeeShares = account.creatorFeeShares;
        pending.buybackFeeShares = account.buybackFeeShares;
        pending.totalFeeShares = pending.creatorFeeShares + pending.buybackFeeShares;
        if (pending.totalFeeShares == 0) revert NothingToSettle(vault);
        account.creatorFeeShares = 0;
        account.buybackFeeShares = 0;
    }

    function _validateLegs(address router, SwapLeg[] calldata legs, address forbiddenVault)
        private
        view
    {
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (!OTFEntryExitRouter(payable(router)).isAdapterApproved(leg.adapter)) {
                revert UnapprovedAdapter(leg.adapter);
            }
            if (
                leg.tokenIn == address(0) || leg.tokenOut == address(0)
                    || leg.tokenIn == leg.tokenOut || leg.tokenIn == forbiddenVault
                    || leg.tokenOut == forbiddenVault
            ) {
                revert InvalidRouteToken(i, leg.tokenIn, leg.tokenOut);
            }
        }
    }

    function _checkWethOutput(uint256 wethBefore, uint256 reportedWeth, uint256 minWethOut)
        private
        view
        returns (uint256 wethOut)
    {
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        wethOut = wethAfter >= wethBefore ? wethAfter - wethBefore : 0;
        if (wethOut != reportedWeth) {
            revert BalanceDeltaMismatch(weth, reportedWeth, wethOut);
        }
        if (wethOut < minWethOut) revert MinimumOutputNotMet(weth, minWethOut, wethOut);
    }

    function _finishSettlement(
        address vault,
        PendingSettlement memory pending,
        uint256 wethOut,
        uint256 minOtfOut,
        uint256 deadline,
        bool sharesRedeemed
    ) private returns (uint256 creatorWeth, uint256 buybackWeth, uint256 otfBurned) {
        creatorWeth = pending.creatorFeeShares == 0
            ? 0
            : Math.mulDiv(wethOut, pending.creatorFeeShares, pending.totalFeeShares);
        buybackWeth = wethOut - creatorWeth;
        if (creatorWeth != 0) _pushExact(weth, pending.beneficiary, creatorWeth);
        otfBurned = _buyOtf(buybackWeth, minOtfOut, deadline);
        uint256 otfBeforeBurn = IERC20(otf).balanceOf(address(this));
        IOTFBurnable(otf).burn(otfBurned);
        uint256 otfAfterBurn = IERC20(otf).balanceOf(address(this));
        uint256 observedBurn = otfBeforeBurn >= otfAfterBurn ? otfBeforeBurn - otfAfterBurn : 0;
        if (observedBurn != otfBurned) {
            revert BalanceDeltaMismatch(otf, otfBurned, observedBurn);
        }
        emit FeesSettled(
            vault,
            pending.beneficiary,
            sharesRedeemed,
            pending.creatorFeeShares,
            pending.buybackFeeShares,
            creatorWeth,
            buybackWeth,
            otfBurned
        );
    }

    function _buyOtf(uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        private
        returns (uint256 amountOut)
    {
        if (amountIn > type(uint128).max || minAmountOut > type(uint128).max) {
            revert InvalidAmount();
        }
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 otfBefore = IERC20(otf).balanceOf(address(this));
        _approveExact(weth, permit2, amountIn);
        // amountIn is bounded to uint128 above, so it also fits uint160.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 permitAmount = uint160(amountIn);
        IPermit2AllowanceTransfer(permit2)
            .approve(weth, universalRouter, permitAmount, uint48(block.timestamp + 1));

        UniswapV4PathKey[] memory path = new UniswapV4PathKey[](1);
        path[0] = UniswapV4PathKey(otf, 0, 1, launchManager, "");
        uint256[] memory maxHopSlippage = new uint256[](0);
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(
            UniswapV4ExactInputParams({
                currencyIn: weth,
                path: path,
                maxHopSlippage: maxHopSlippage,
                // Both values are explicitly bounded before this call.
                // forge-lint: disable-next-line(unsafe-typecast)
                amountIn: uint128(amountIn),
                // forge-lint: disable-next-line(unsafe-typecast)
                amountOutMinimum: uint128(minAmountOut)
            })
        );
        actionParams[1] = abi.encode(weth, amountIn);
        actionParams[2] = abi.encode(otf, minAmountOut);
        bytes[] memory commandInputs = new bytes[](1);
        commandInputs[0] = abi.encode(
            abi.encodePacked(SWAP_EXACT_IN_ACTION, SETTLE_ALL_ACTION, TAKE_ALL_ACTION), actionParams
        );
        IUniswapUniversalRouter(universalRouter)
            .execute(abi.encodePacked(V4_SWAP_COMMAND), commandInputs, deadline);

        IPermit2AllowanceTransfer(permit2).approve(weth, universalRouter, 0, 0);
        _approveExact(weth, permit2, 0);
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        uint256 observedInput = wethBefore >= wethAfter ? wethBefore - wethAfter : 0;
        if (observedInput != amountIn) {
            revert BalanceDeltaMismatch(weth, amountIn, observedInput);
        }
        uint256 otfAfter = IERC20(otf).balanceOf(address(this));
        amountOut = otfAfter >= otfBefore ? otfAfter - otfBefore : 0;
        if (amountOut < minAmountOut) {
            revert MinimumOutputNotMet(otf, minAmountOut, amountOut);
        }
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        if (!IERC20(token).approve(spender, amount)) {
            revert ApprovalFailed(token, spender, amount);
        }
        uint256 observed = IERC20(token).allowance(address(this), spender);
        if (observed != amount) revert ApprovalFailed(token, spender, amount);
    }

    function _pushExact(address token, address receiver, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 receiverBefore = IERC20(token).balanceOf(receiver);
        token.safeTransfer(receiver, amount);
        uint256 senderAfter = IERC20(token).balanceOf(address(this));
        uint256 receiverAfter = IERC20(token).balanceOf(receiver);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert BalanceDeltaMismatch(token, amount, receiverDelta);
        }
    }

    function _isFactoryVault(address vault) private view returns (bool) {
        address factory_ = factory;
        return factory_ != address(0) && vault.code.length != 0
            && IBuybackFactory(factory_).isVault(vault);
    }

    function _entryExitRouter() private view returns (address router) {
        address factory_ = factory;
        if (factory_ == address(0)) revert FactoryNotConfigured();
        router = IBuybackFactory(factory_).entryExitRouter();
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
