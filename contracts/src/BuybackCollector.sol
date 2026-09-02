// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapUniversalRouter,
    IUniswapV4ImmutableState,
    UniswapV4ExactInputParams,
    UniswapV4PathKey
} from "./interfaces/IUniswapV4.sol";
import { BasketRedeemRequest, OTFEntryExitRouter, SwapLeg } from "./OTFEntryExitRouter.sol";

interface IOTFBurnable is IERC20 {
    function burn(uint256 amount) external;
}

interface IBuybackLaunchManager {
    function otf() external view returns (address);
    function weth() external view returns (address);
    function poolManager() external view returns (address);
}

/// @notice Redeems protocol-owned fund fee shares, routes proceeds to WETH, buys OTF, and burns it.
contract BuybackCollector is Ownable2Step {
    bytes1 private constant V4_SWAP_COMMAND = 0x10;
    bytes1 private constant SWAP_EXACT_IN_ACTION = 0x07;
    bytes1 private constant SETTLE_ALL_ACTION = 0x0c;
    bytes1 private constant TAKE_ALL_ACTION = 0x0f;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidAmount();
    error DeadlineExpired(uint256 deadline);
    error UnapprovedAdapter(address adapter);
    error InvalidRouteToken(uint256 leg, address tokenIn, address tokenOut);
    error ApprovalFailed(address token, address spender, uint256 amount);
    error BalanceDeltaMismatch(address token, uint256 expected, uint256 observed);
    error MinimumOutputNotMet(address token, uint256 minimum, uint256 actual);
    error Reentrancy();
    error RouterAlreadyConfigured();
    error UnauthorizedRouterConfigurator(address caller);

    event BuybackExecuted(
        address indexed vault, uint256 feeSharesRedeemed, uint256 wethSpent, uint256 otfBurned
    );
    event EntryExitRouterConfigured(address indexed router);

    address public immutable routerConfigurator;
    address public immutable launchManager;
    address public immutable otf;
    address public immutable weth;
    address public immutable universalRouter;
    address public immutable permit2;
    address public immutable poolManager;
    address public entryExitRouter;
    bool private _entered;

    constructor(
        address routeExecutor,
        address launchManager_,
        address universalRouter_,
        address permit2_
    ) Ownable(routeExecutor) {
        if (routeExecutor == address(0)) revert ZeroAddress();
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

    function configureEntryExitRouter(address router) external {
        if (msg.sender != routerConfigurator) {
            revert UnauthorizedRouterConfigurator(msg.sender);
        }
        if (entryExitRouter != address(0)) revert RouterAlreadyConfigured();
        _requireContract(router);
        entryExitRouter = router;
        emit EntryExitRouterConfigured(router);
    }

    function executeBuyback(
        address vault,
        uint256 feeShares,
        uint256[] calldata minBasketAmounts,
        SwapLeg[] calldata legs,
        uint256 minWethOut,
        uint256 minOtfOut,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 wethSpent, uint256 otfBurned) {
        // Deadlines are intentionally enforced against the current transaction timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (
            feeShares == 0 || minWethOut == 0 || minOtfOut == 0 || minWethOut > type(uint128).max
                || minOtfOut > type(uint128).max
        ) revert InvalidAmount();
        _requireContract(vault);
        address router = entryExitRouter;
        _requireContract(router);
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (!OTFEntryExitRouter(payable(router)).isAdapterApproved(leg.adapter)) {
                revert UnapprovedAdapter(leg.adapter);
            }
            if (
                leg.tokenIn == address(0) || leg.tokenOut == address(0)
                    || leg.tokenIn == leg.tokenOut || leg.tokenIn == vault || leg.tokenOut == vault
            ) {
                revert InvalidRouteToken(i, leg.tokenIn, leg.tokenOut);
            }
        }

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        _approveExact(vault, router, feeShares);
        (uint256 reportedWeth,,) = OTFEntryExitRouter(payable(router))
            .redeemToToken(
                BasketRedeemRequest({
                vault: vault,
                outputToken: weth,
                shares: feeShares,
                minAmountOut: minWethOut,
                deadline: deadline
            }),
                minBasketAmounts,
                legs
            );
        _approveExact(vault, router, 0);
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        wethSpent = wethAfter >= wethBefore ? wethAfter - wethBefore : 0;
        if (wethSpent != reportedWeth) {
            revert BalanceDeltaMismatch(weth, reportedWeth, wethSpent);
        }
        if (wethSpent < minWethOut) revert MinimumOutputNotMet(weth, minWethOut, wethSpent);

        otfBurned = _buyOtf(wethSpent, minOtfOut, deadline);
        IOTFBurnable(otf).burn(otfBurned);
        emit BuybackExecuted(vault, feeShares, wethSpent, otfBurned);
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

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
