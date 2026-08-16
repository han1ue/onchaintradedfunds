// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAssetMarketRegistry } from "./interfaces/IAssetMarketRegistry.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { IUniswapV3SwapRouter } from "./UniswapV3Adapter.sol";
import { IUniswapV3MarketPool } from "./AssetMarketRegistry.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

/// @notice V3-only adapter that derives every hop from the protocol market registry.
/// @dev Deploy one instance for USDG and one for WETH investor settlement.
contract RegisteredUniswapV3Adapter is ITradeAdapter {
    using SafeTransferLib for address;

    error NotOwner();
    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidSettlementToken(address settlementToken);
    error InvalidAmount();
    error InvalidRoute(address tokenIn, address tokenOut);
    error InvalidMarket(bytes32 marketId, address asset);
    error Slippage(uint256 received, uint256 minimum);
    error InputMismatch(uint256 expected, uint256 observed);
    error OutputMismatch(uint256 reported, uint256 observed);
    error Reentrancy();

    event CallerApprovalChanged(address indexed caller, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public immutable uniswapRouter;
    IAssetMarketRegistry public immutable marketRegistry;
    address public immutable settlementToken;
    address public immutable weth;
    address public immutable usdg;
    uint24 public immutable wethUsdgFee;
    mapping(address => bool) public isCallerApproved;
    bool private _entered;

    constructor(
        address initialOwner,
        address uniswapRouter_,
        IAssetMarketRegistry marketRegistry_,
        address settlementToken_
    ) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (uniswapRouter_.code.length == 0) revert InvalidDependency(uniswapRouter_);
        if (address(marketRegistry_).code.length == 0) {
            revert InvalidDependency(address(marketRegistry_));
        }
        address weth_ = marketRegistry_.weth();
        address usdg_ = marketRegistry_.usdg();
        if (settlementToken_ != weth_ && settlementToken_ != usdg_) {
            revert InvalidSettlementToken(settlementToken_);
        }
        address bridgePool = marketRegistry_.wethUsdgPool();
        if (bridgePool.code.length == 0) revert InvalidDependency(bridgePool);
        owner = initialOwner;
        uniswapRouter = uniswapRouter_;
        marketRegistry = marketRegistry_;
        settlementToken = settlementToken_;
        weth = weth_;
        usdg = usdg_;
        wethUsdgFee = IUniswapV3MarketPool(bridgePool).fee();
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyApprovedCaller() {
        if (!isCallerApproved[msg.sender]) revert UnauthorizedCaller(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function setCallerApproved(address caller, bool approved) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        isCallerApproved[caller] = approved;
        emit CallerApprovalChanged(caller, approved);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function marketIdFromData(bytes calldata data) external pure returns (bytes32 marketId) {
        marketId = abi.decode(data, (bytes32));
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyApprovedCaller nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) revert InvalidAmount();
        if (tokenIn != settlementToken && tokenOut != settlementToken) {
            revert InvalidRoute(tokenIn, tokenOut);
        }
        bytes32 marketId = abi.decode(data, (bytes32));
        address asset = tokenIn == settlementToken ? tokenOut : tokenIn;
        bytes memory path = _registeredPath(tokenIn, tokenOut, asset, marketId);

        uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outputBefore = IERC20(tokenOut).balanceOf(msg.sender);
        tokenIn.safeApprove(uniswapRouter, 0);
        tokenIn.safeApprove(uniswapRouter, amountIn);
        uint256 reportedOutput = IUniswapV3SwapRouter(uniswapRouter)
            .exactInput(
                IUniswapV3SwapRouter.ExactInputParams({
                    path: path,
                    recipient: msg.sender,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut
                })
            );
        tokenIn.safeApprove(uniswapRouter, 0);

        uint256 observedInput = inputBefore - IERC20(tokenIn).balanceOf(address(this));
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - outputBefore;
        if (observedInput != amountIn) revert InputMismatch(amountIn, observedInput);
        if (reportedOutput != amountOut) revert OutputMismatch(reportedOutput, amountOut);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
    }

    function _registeredPath(
        address tokenIn,
        address tokenOut,
        address asset,
        bytes32 marketId
    ) private view returns (bytes memory path) {
        if (settlementToken == weth) {
            (,,, uint24 fee, bool wethRouteActive) = marketRegistry.marketFor(marketId);
            if (!wethRouteActive || !marketRegistry.isActiveMarketForAsset(marketId, asset)) {
                revert InvalidMarket(marketId, asset);
            }
            return abi.encodePacked(tokenIn, bytes3(fee), tokenOut);
        }

        if (asset == weth) {
            if (marketId != bytes32(0)) revert InvalidMarket(marketId, asset);
            return abi.encodePacked(tokenIn, bytes3(wethUsdgFee), tokenOut);
        }

        (,,, uint24 assetFee, bool active) = marketRegistry.marketFor(marketId);
        if (!active || !marketRegistry.isActiveMarketForAsset(marketId, asset)) {
            revert InvalidMarket(marketId, asset);
        }
        path = tokenIn == asset
            ? abi.encodePacked(asset, bytes3(assetFee), weth, bytes3(wethUsdgFee), usdg)
            : abi.encodePacked(usdg, bytes3(wethUsdgFee), weth, bytes3(assetFee), asset);
    }
}
