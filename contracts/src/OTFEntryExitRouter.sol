// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IWETH } from "./interfaces/IWETH.sol";
import { IOTFSettlementFactory, IOTFSettlementVault } from "./interfaces/IOTFSettlement.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

struct SwapLeg {
    address adapter;
    address tokenIn;
    address tokenOut;
    /// @dev `type(uint256).max` spends this token's complete current transient balance.
    uint256 amountIn;
    uint256 minAmountOut;
    bytes data;
}

struct BasketMintRequest {
    address inputToken;
    address vault;
    uint256 amountIn;
    uint256 minShares;
    uint256 deadline;
}

struct BasketRedeemRequest {
    address vault;
    address outputToken;
    uint256 shares;
    uint256 minAmountOut;
    uint256 deadline;
}

struct BasketSwapRequest {
    address sourceVault;
    address targetVault;
    uint256 sharesIn;
    uint256 minSharesOut;
    uint256 deadline;
}

struct FeeShareSwapRequest {
    address vault;
    uint256 shares;
    uint256 minAmountOut;
    uint256 deadline;
}

/// @notice Atomic OTF basket settlement through explicitly approved trade adapters.
/// @dev Route discovery and comparison are offchain. The adapter manager is trusted only to
///      authorize adapters; adapters are trusted execution boundaries whose balance deltas are
///      independently checked here.
contract OTFEntryExitRouter is Ownable2Step {
    using SafeTransferLib for address;

    uint256 public constant MAX_CONSTITUENTS = 20;
    uint256 public constant MAX_LEGS = 40;
    /// @dev Two share tokens, two baskets, and two explicit endpoint tokens per leg.
    uint256 public constant MAX_TRACKED_TOKENS = 2 + 2 * MAX_CONSTITUENTS + 2 * MAX_LEGS;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error InvalidRouteKind();
    error InvalidArrayLength();
    error InvalidAmount();
    error ZeroMinimumOutput();
    error DeadlineExpired(uint256 deadline);
    error TooManyLegs(uint256 supplied, uint256 maximum);
    error TooManyRouteTokens(uint256 maximum);
    error ForbiddenRouteToken(address token);
    error DuplicateAsset(address asset);
    error UnapprovedAdapter(address adapter);
    error InvalidAdapterRouter(address adapter, address expected, address observed);
    error InsufficientRouteBalance(address token, uint256 available, uint256 requested);
    error UnexpectedBalanceDecrease(address token, uint256 baseline, uint256 current);
    error SwapInputMismatch(uint256 leg, uint256 expected, uint256 observed);
    error SwapOutputMismatch(uint256 leg, uint256 reported, uint256 observed);
    error SettlementInputMismatch(uint256 index, uint256 expected, uint256 observed);
    error SettlementOutputMismatch(uint256 index, uint256 reported, uint256 observed);
    error ShareBalanceMismatch(uint256 expected, uint256 observed);
    error ApprovalMismatch(address token, address spender, uint256 expected, uint256 observed);
    error IncompleteLiquidation(address token, uint256 amount);
    error CallerBalanceMismatch(
        address token, uint256 baseline, uint256 debits, uint256 credits, uint256 observed
    );
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error ResidualBalance(address token, uint256 baseline, uint256 current);
    error InvalidNativeValue(uint256 expected, uint256 received);
    error InvalidNativeEndpoint(address token);
    error UnexpectedNativeSender(address sender);
    error NativeTransferFailed(address recipient, uint256 amount);
    error NativeBalanceMismatch(uint256 expected, uint256 observed);
    error UnauthorizedFeeCollector(address caller);
    error Reentrancy();

    event AdapterApprovalChanged(address indexed adapter, bool approved);
    event BasketMinted(
        address indexed caller,
        address indexed vault,
        address indexed inputToken,
        uint256 amountIn,
        uint256 shares,
        uint256 inputRefunded
    );
    event BasketRedeemed(
        address indexed caller,
        address indexed vault,
        address indexed outputToken,
        uint256 shares,
        uint256 amountOut
    );
    event BasketSwapped(
        address indexed caller,
        address indexed sourceVault,
        address indexed targetVault,
        uint256 sharesIn,
        uint256 sharesOut
    );
    event NativeBasketMinted(
        address indexed caller,
        address indexed vault,
        uint256 amountIn,
        uint256 shares,
        uint256 nativeRefunded
    );
    event NativeBasketRedeemed(
        address indexed caller, address indexed vault, uint256 shares, uint256 amountOut
    );
    event FeeSharesSwapped(address indexed vault, uint256 shares, uint256 amountOut);

    struct BalanceSheet {
        address[] tokens;
        uint256[] baselines;
        uint256[] callerBaselines;
        uint256[] callerDebits;
        uint256[] callerCredits;
        uint256 count;
    }

    struct RouteContext {
        BalanceSheet sheet;
        address[] assets;
    }

    address public immutable factory;
    address public immutable weth;
    mapping(address => bool) public isAdapterApproved;
    bool private _entered;

    constructor(address factory_, address initialAdapterManager, address weth_)
        Ownable(initialAdapterManager)
    {
        _requireContract(factory_);
        _requireContract(weth_);
        factory = factory_;
        weth = weth_;
    }

    receive() external payable {
        if (msg.sender != weth) revert UnexpectedNativeSender(msg.sender);
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Adds or immediately revokes an adapter execution boundary.
    function setAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (approved) {
            _requireContract(adapter);
            address observed = ITradeAdapter(adapter).entryExitRouter();
            if (observed != address(this)) {
                revert InvalidAdapterRouter(adapter, address(this), observed);
            }
        } else if (adapter == address(0)) {
            revert ZeroAddress();
        }
        isAdapterApproved[adapter] = approved;
        emit AdapterApprovalChanged(adapter, approved);
    }

    /// @notice Acquires constituents through ordered adapter legs and mints maximum OTF shares.
    function mintFromToken(BasketMintRequest calldata request, SwapLeg[] calldata legs)
        external
        nonReentrant
        returns (uint256 shares, address[] memory refundTokens, uint256[] memory refundAmounts)
    {
        RouteContext memory context = _prepareMint(request, legs);
        _recordDebit(context.sheet, request.inputToken, request.amountIn);
        _pullExact(request.inputToken, msg.sender, request.amountIn);
        shares = _processMint(context, request, legs);
        (refundTokens, refundAmounts) = _refundAndClose(context.sheet, msg.sender);

        emit BasketMinted(
            msg.sender,
            request.vault,
            request.inputToken,
            request.amountIn,
            shares,
            _refundAmount(refundTokens, refundAmounts, request.inputToken)
        );
    }

    /// @notice Wraps exact native input, acquires constituents, and refunds residual WETH as ETH.
    function mintFromNative(BasketMintRequest calldata request, SwapLeg[] calldata legs)
        external
        payable
        nonReentrant
        returns (
            uint256 shares,
            address[] memory refundTokens,
            uint256[] memory refundAmounts,
            uint256 nativeRefunded
        )
    {
        if (msg.value != request.amountIn) {
            revert InvalidNativeValue(request.amountIn, msg.value);
        }
        if (request.inputToken != weth) revert InvalidNativeEndpoint(request.inputToken);
        RouteContext memory context = _prepareMint(request, legs);
        uint256 nativeBaseline = address(this).balance - msg.value;
        _wrapExact(request.amountIn);
        shares = _processMint(context, request, legs);
        (refundTokens, refundAmounts, nativeRefunded) =
            _refundAndCloseNativeMint(context.sheet, nativeBaseline);

        emit NativeBasketMinted(msg.sender, request.vault, request.amountIn, shares, nativeRefunded);
    }

    /// @notice Redeems an OTF, liquidates every constituent, and pays one output token.
    function redeemToToken(
        BasketRedeemRequest calldata request,
        uint256[] calldata minBasketAmounts,
        SwapLeg[] calldata legs
    )
        external
        nonReentrant
        returns (uint256 amountOut, address[] memory refundTokens, uint256[] memory refundAmounts)
    {
        RouteContext memory context = _prepareRedeem(request, minBasketAmounts, legs);
        amountOut = _processRedeem(context, request, minBasketAmounts, legs);
        _recordCredit(context.sheet, request.outputToken, amountOut);
        _pushExact(request.outputToken, msg.sender, amountOut);
        // Output-token callbacks must not reintroduce a constituent after liquidation.
        _requireOnlyOutput(context.sheet, request.outputToken);
        (refundTokens, refundAmounts) = _refundAndClose(context.sheet, msg.sender);

        emit BasketRedeemed(
            msg.sender, request.vault, request.outputToken, request.shares, amountOut
        );
    }

    /// @notice Redeems an OTF through WETH settlement and pays exact transient output as ETH.
    function redeemToNative(
        BasketRedeemRequest calldata request,
        uint256[] calldata minBasketAmounts,
        SwapLeg[] calldata legs
    )
        external
        nonReentrant
        returns (uint256 amountOut, address[] memory refundTokens, uint256[] memory refundAmounts)
    {
        if (request.outputToken != weth) {
            revert InvalidNativeEndpoint(request.outputToken);
        }
        RouteContext memory context = _prepareRedeem(request, minBasketAmounts, legs);
        uint256 nativeBaseline = address(this).balance;
        amountOut = _processRedeem(context, request, minBasketAmounts, legs);
        IWETH(weth).withdraw(amountOut);
        if (_transientBalance(context.sheet, weth) != 0) {
            revert ResidualBalance(
                weth,
                context.sheet.baselines[_tokenIndex(context.sheet, weth)],
                IERC20(weth).balanceOf(address(this))
            );
        }
        _sendNative(msg.sender, amountOut);
        _assertNativeBaseline(nativeBaseline);
        (refundTokens, refundAmounts) = _refundAndClose(context.sheet, msg.sender);

        emit NativeBasketRedeemed(msg.sender, request.vault, request.shares, amountOut);
    }

    /// @notice Sells registered fund fee shares through approved adapters into canonical WETH.
    /// @dev This narrow route is callable only by the factory's fee collector.
    function swapFeeSharesToWeth(FeeShareSwapRequest calldata request, SwapLeg[] calldata legs)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (msg.sender != IOTFSettlementFactory(factory).buybackCollector()) {
            revert UnauthorizedFeeCollector(msg.sender);
        }
        _validateDeadline(request.deadline);
        _requireVault(request.vault);
        if (request.shares == 0) revert InvalidAmount();
        if (request.minAmountOut == 0) revert ZeroMinimumOutput();

        BalanceSheet memory sheet = _newBalanceSheet();
        _addToken(sheet, request.vault);
        _addToken(sheet, weth);
        _prepareLegs(sheet, legs, address(0), address(0));
        _snapshot(sheet);

        _recordDebit(sheet, request.vault, request.shares);
        _pullExact(request.vault, msg.sender, request.shares);
        _executeLegs(sheet, legs);
        _requireOnlyOutput(sheet, weth);
        amountOut = _transientBalance(sheet, weth);
        if (amountOut < request.minAmountOut) {
            revert MinimumOutputNotMet(request.minAmountOut, amountOut);
        }
        _recordCredit(sheet, weth, amountOut);
        _pushExact(weth, msg.sender, amountOut);
        (address[] memory refundTokens,) = _refundAndClose(sheet, msg.sender);
        if (refundTokens.length != 0) revert InvalidRouteKind();

        emit FeeSharesSwapped(request.vault, request.shares, amountOut);
    }

    function _prepareMint(BasketMintRequest calldata request, SwapLeg[] calldata legs)
        private
        returns (RouteContext memory context)
    {
        _validateMintRequest(request);
        context.assets = _validatedAssets(request.vault);
        context.sheet = _newBalanceSheet();
        _addToken(context.sheet, request.inputToken);
        _addToken(context.sheet, request.vault);
        _addAssets(context.sheet, context.assets);
        _prepareLegs(context.sheet, legs, request.vault, address(0));
        IOTFSettlementVault(request.vault).checkpointFees();
        _snapshot(context.sheet);
    }

    function _processMint(
        RouteContext memory context,
        BasketMintRequest calldata request,
        SwapLeg[] calldata legs
    ) private returns (uint256 shares) {
        _executeLegs(context.sheet, legs);
        shares = _mintMaximum(request.vault, context.assets, request.minShares, context.sheet);
    }

    function _prepareRedeem(
        BasketRedeemRequest calldata request,
        uint256[] calldata minBasketAmounts,
        SwapLeg[] calldata legs
    ) private returns (RouteContext memory context) {
        _validateRedeemRequest(request);
        context.assets = _validatedAssets(request.vault);
        if (minBasketAmounts.length != context.assets.length) revert InvalidArrayLength();
        context.sheet = _newBalanceSheet();
        _addToken(context.sheet, request.vault);
        _addToken(context.sheet, request.outputToken);
        _addAssets(context.sheet, context.assets);
        _prepareLegs(context.sheet, legs, request.vault, address(0));
        IOTFSettlementVault(request.vault).checkpointFees();
        _snapshot(context.sheet);
    }

    function _processRedeem(
        RouteContext memory context,
        BasketRedeemRequest calldata request,
        uint256[] calldata minBasketAmounts,
        SwapLeg[] calldata legs
    ) private returns (uint256 amountOut) {
        _recordDebit(context.sheet, request.vault, request.shares);
        _redeemBasket(request.vault, context.assets, request.shares, msg.sender, minBasketAmounts);
        _executeLegs(context.sheet, legs);
        _requireOnlyOutput(context.sheet, request.outputToken);
        amountOut = _transientBalance(context.sheet, request.outputToken);
        if (amountOut < request.minAmountOut) {
            revert MinimumOutputNotMet(request.minAmountOut, amountOut);
        }
    }

    /// @notice Redeems one OTF, routes its constituents, and mints another OTF atomically.
    function swapBasketToBasket(
        BasketSwapRequest calldata request,
        uint256[] calldata minSourceAmounts,
        SwapLeg[] calldata legs
    )
        external
        nonReentrant
        returns (uint256 sharesOut, address[] memory refundTokens, uint256[] memory refundAmounts)
    {
        _validateBasketSwapRequest(request);
        address[] memory sourceAssets = _validatedAssets(request.sourceVault);
        address[] memory targetAssets = _validatedAssets(request.targetVault);
        if (minSourceAmounts.length != sourceAssets.length) revert InvalidArrayLength();

        BalanceSheet memory sheet = _newBalanceSheet();
        _addToken(sheet, request.sourceVault);
        _addToken(sheet, request.targetVault);
        _addAssets(sheet, sourceAssets);
        _addAssets(sheet, targetAssets);
        _prepareLegs(sheet, legs, request.sourceVault, request.targetVault);
        IOTFSettlementVault(request.sourceVault).checkpointFees();
        IOTFSettlementVault(request.targetVault).checkpointFees();
        _snapshot(sheet);

        _recordDebit(sheet, request.sourceVault, request.sharesIn);
        _redeemBasket(
            request.sourceVault, sourceAssets, request.sharesIn, msg.sender, minSourceAmounts
        );
        _executeLegs(sheet, legs);
        sharesOut = _mintMaximum(request.targetVault, targetAssets, request.minSharesOut, sheet);
        (refundTokens, refundAmounts) = _refundAndClose(sheet, msg.sender);

        emit BasketSwapped(
            msg.sender, request.sourceVault, request.targetVault, request.sharesIn, sharesOut
        );
    }

    function _validateMintRequest(BasketMintRequest calldata request) private view {
        _validateDeadline(request.deadline);
        _requireToken(request.inputToken);
        _requireVault(request.vault);
        if (
            request.inputToken == request.vault
                || IOTFSettlementFactory(factory).isVault(request.inputToken)
        ) {
            revert InvalidRouteKind();
        }
        if (request.amountIn == 0) revert InvalidAmount();
        if (request.minShares == 0) revert ZeroMinimumOutput();
    }

    function _validateRedeemRequest(BasketRedeemRequest calldata request) private view {
        _validateDeadline(request.deadline);
        _requireVault(request.vault);
        _requireToken(request.outputToken);
        if (
            request.outputToken == request.vault
                || IOTFSettlementFactory(factory).isVault(request.outputToken)
        ) {
            revert InvalidRouteKind();
        }
        if (request.shares == 0) revert InvalidAmount();
        if (request.minAmountOut == 0) revert ZeroMinimumOutput();
    }

    function _validateBasketSwapRequest(BasketSwapRequest calldata request) private view {
        _validateDeadline(request.deadline);
        _requireVault(request.sourceVault);
        _requireVault(request.targetVault);
        if (request.sourceVault == request.targetVault) revert InvalidRouteKind();
        if (request.sharesIn == 0) revert InvalidAmount();
        if (request.minSharesOut == 0) revert ZeroMinimumOutput();
    }

    function _validateDeadline(uint256 deadline) private view {
        // User-supplied route deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
    }

    function _requireVault(address vault) private view {
        _requireToken(vault);
        if (!IOTFSettlementFactory(factory).isVault(vault)) revert InvalidVault(vault);
    }

    function _requireToken(address token) private view {
        _requireContract(token);
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }

    function _validatedAssets(address vault) private view returns (address[] memory assets) {
        assets = IOTFSettlementVault(vault).assets();
        if (assets.length == 0 || assets.length > MAX_CONSTITUENTS) {
            revert InvalidArrayLength();
        }
        for (uint256 i = 0; i < assets.length; i++) {
            _requireToken(assets[i]);
            for (uint256 j = 0; j < i; j++) {
                if (assets[j] == assets[i]) revert DuplicateAsset(assets[i]);
            }
        }
    }

    function _newBalanceSheet() private pure returns (BalanceSheet memory sheet) {
        sheet.tokens = new address[](MAX_TRACKED_TOKENS);
        sheet.baselines = new uint256[](MAX_TRACKED_TOKENS);
        sheet.callerBaselines = new uint256[](MAX_TRACKED_TOKENS);
        sheet.callerDebits = new uint256[](MAX_TRACKED_TOKENS);
        sheet.callerCredits = new uint256[](MAX_TRACKED_TOKENS);
    }

    function _addAssets(BalanceSheet memory sheet, address[] memory assets) private view {
        for (uint256 i = 0; i < assets.length; i++) {
            _addToken(sheet, assets[i]);
        }
    }

    function _addToken(BalanceSheet memory sheet, address token) private view {
        _requireToken(token);
        for (uint256 i = 0; i < sheet.count; i++) {
            if (sheet.tokens[i] == token) return;
        }
        if (sheet.count == MAX_TRACKED_TOKENS) revert TooManyRouteTokens(MAX_TRACKED_TOKENS);
        sheet.tokens[sheet.count] = token;
        sheet.count++;
    }

    function _prepareLegs(
        BalanceSheet memory sheet,
        SwapLeg[] calldata legs,
        address forbiddenToken0,
        address forbiddenToken1
    ) private view {
        if (legs.length > MAX_LEGS) {
            revert TooManyLegs(legs.length, MAX_LEGS);
        }
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            _requireContract(leg.adapter);
            if (!isAdapterApproved[leg.adapter]) revert UnapprovedAdapter(leg.adapter);
            address observed = ITradeAdapter(leg.adapter).entryExitRouter();
            if (observed != address(this)) {
                revert InvalidAdapterRouter(leg.adapter, address(this), observed);
            }
            if (leg.amountIn == 0 || leg.minAmountOut == 0) revert InvalidAmount();
            if (leg.tokenIn == leg.tokenOut) revert InvalidRouteKind();
            if (
                leg.tokenIn == forbiddenToken0 || leg.tokenIn == forbiddenToken1
                    || leg.tokenOut == forbiddenToken0 || leg.tokenOut == forbiddenToken1
            ) {
                revert ForbiddenRouteToken(leg.tokenIn == forbiddenToken0
                        || leg.tokenIn == forbiddenToken1
                        ? leg.tokenIn
                        : leg.tokenOut);
            }
            _addToken(sheet, leg.tokenIn);
            _addToken(sheet, leg.tokenOut);
        }
    }

    function _snapshot(BalanceSheet memory sheet) private view {
        for (uint256 i = 0; i < sheet.count; i++) {
            sheet.baselines[i] = IERC20(sheet.tokens[i]).balanceOf(address(this));
            sheet.callerBaselines[i] = IERC20(sheet.tokens[i]).balanceOf(msg.sender);
        }
    }

    function _executeLegs(BalanceSheet memory sheet, SwapLeg[] calldata legs) private {
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            uint256 available = _transientBalance(sheet, leg.tokenIn);
            uint256 amountIn = leg.amountIn == type(uint256).max ? available : leg.amountIn;
            if (amountIn == 0 || amountIn > available) {
                revert InsufficientRouteBalance(leg.tokenIn, available, amountIn);
            }

            uint256 inputBefore = IERC20(leg.tokenIn).balanceOf(address(this));
            _pushExact(leg.tokenIn, leg.adapter, amountIn);
            uint256 outputBefore = IERC20(leg.tokenOut).balanceOf(address(this));
            uint256 reported = ITradeAdapter(leg.adapter)
                .executeSwap(leg.tokenIn, leg.tokenOut, amountIn, leg.minAmountOut, leg.data);
            if (!isAdapterApproved[leg.adapter]) revert UnapprovedAdapter(leg.adapter);

            uint256 inputAfter = IERC20(leg.tokenIn).balanceOf(address(this));
            uint256 outputAfter = IERC20(leg.tokenOut).balanceOf(address(this));
            uint256 observedInput = inputBefore >= inputAfter ? inputBefore - inputAfter : 0;
            uint256 observedOutput = outputAfter >= outputBefore ? outputAfter - outputBefore : 0;
            if (observedInput != amountIn) revert SwapInputMismatch(i, amountIn, observedInput);
            if (reported != observedOutput) revert SwapOutputMismatch(i, reported, observedOutput);
            if (observedOutput < leg.minAmountOut) {
                revert MinimumOutputNotMet(leg.minAmountOut, observedOutput);
            }
        }
    }

    function _mintMaximum(
        address vault,
        address[] memory assets,
        uint256 minShares,
        BalanceSheet memory sheet
    ) private returns (uint256 shares) {
        uint256[] memory maxima = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            maxima[i] = _transientBalance(sheet, assets[i]);
        }

        uint256[] memory required;
        (shares, required) = IOTFSettlementVault(vault).previewMaxMint(maxima);
        if (required.length != assets.length) revert InvalidArrayLength();
        if (shares < minShares) revert MinimumOutputNotMet(minShares, shares);

        uint256 receiverBefore = IOTFSettlementVault(vault).balanceOf(msg.sender);
        uint256[] memory balancesBefore = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            if (required[i] > maxima[i]) {
                revert InsufficientRouteBalance(assets[i], maxima[i], required[i]);
            }
            balancesBefore[i] = IERC20(assets[i]).balanceOf(address(this));
            _approveExact(assets[i], vault, 0);
            _approveExact(assets[i], vault, required[i]);
        }
        uint256[] memory reported =
            IOTFSettlementVault(vault).routerMint(shares, msg.sender, required);
        if (reported.length != assets.length) revert InvalidArrayLength();

        for (uint256 i = 0; i < assets.length; i++) {
            _approveExact(assets[i], vault, 0);
            uint256 balanceAfter = IERC20(assets[i]).balanceOf(address(this));
            uint256 observed =
                balancesBefore[i] >= balanceAfter ? balancesBefore[i] - balanceAfter : 0;
            if (reported[i] != required[i] || observed != required[i]) {
                revert SettlementInputMismatch(i, required[i], observed);
            }
        }
        uint256 receiverAfter = IOTFSettlementVault(vault).balanceOf(msg.sender);
        uint256 observedShares =
            receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (observedShares != shares) revert ShareBalanceMismatch(shares, observedShares);
        _recordCredit(sheet, vault, shares);
    }

    function _redeemBasket(
        address vault,
        address[] memory assets,
        uint256 shares,
        address owner,
        uint256[] calldata minimums
    ) private {
        uint256 ownerBefore = IOTFSettlementVault(vault).balanceOf(owner);
        uint256[] memory balancesBefore = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            balancesBefore[i] = IERC20(assets[i]).balanceOf(address(this));
        }
        uint256[] memory reported =
            IOTFSettlementVault(vault).routerRedeem(shares, owner, address(this), minimums);
        if (reported.length != assets.length) revert InvalidArrayLength();

        uint256 ownerAfter = IOTFSettlementVault(vault).balanceOf(owner);
        uint256 observedShares = ownerBefore >= ownerAfter ? ownerBefore - ownerAfter : 0;
        if (observedShares != shares) revert ShareBalanceMismatch(shares, observedShares);
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 balanceAfter = IERC20(assets[i]).balanceOf(address(this));
            uint256 observed =
                balanceAfter >= balancesBefore[i] ? balanceAfter - balancesBefore[i] : 0;
            if (reported[i] != observed) {
                revert SettlementOutputMismatch(i, reported[i], observed);
            }
            if (observed < minimums[i]) {
                revert MinimumOutputNotMet(minimums[i], observed);
            }
        }
    }

    function _transientBalance(BalanceSheet memory sheet, address token)
        private
        view
        returns (uint256 transientBalance)
    {
        uint256 index = _tokenIndex(sheet, token);
        uint256 current = IERC20(token).balanceOf(address(this));
        uint256 baseline = sheet.baselines[index];
        if (current < baseline) revert UnexpectedBalanceDecrease(token, baseline, current);
        return current - baseline;
    }

    function _tokenIndex(BalanceSheet memory sheet, address token)
        private
        pure
        returns (uint256 index)
    {
        for (uint256 i = 0; i < sheet.count; i++) {
            if (sheet.tokens[i] == token) return i;
        }
        revert ForbiddenRouteToken(token);
    }

    function _recordDebit(BalanceSheet memory sheet, address token, uint256 amount) private pure {
        sheet.callerDebits[_tokenIndex(sheet, token)] += amount;
    }

    function _recordCredit(BalanceSheet memory sheet, address token, uint256 amount) private pure {
        sheet.callerCredits[_tokenIndex(sheet, token)] += amount;
    }

    function _requireOnlyOutput(BalanceSheet memory sheet, address outputToken) private view {
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            if (token == outputToken) continue;
            uint256 amount = _transientBalance(sheet, token);
            if (amount != 0) revert IncompleteLiquidation(token, amount);
        }
    }

    function _refundAndClose(BalanceSheet memory sheet, address refundRecipient)
        private
        returns (address[] memory refundTokens, uint256[] memory refundAmounts)
    {
        refundTokens = new address[](sheet.count);
        refundAmounts = new uint256[](sheet.count);
        uint256 refundCount;
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 current = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (current < baseline) revert UnexpectedBalanceDecrease(token, baseline, current);
            uint256 refund = current - baseline;
            if (refund != 0) {
                refundTokens[refundCount] = token;
                refundAmounts[refundCount] = refund;
                refundCount++;
                _recordCredit(sheet, token, refund);
                _pushExact(token, refundRecipient, refund);
            }
            uint256 closed = IERC20(token).balanceOf(address(this));
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        // A later refund token may call back and mutate an earlier token already checked.
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 closed = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        _assertCallerDeltas(sheet, refundRecipient);
        assembly ("memory-safe") {
            mstore(refundTokens, refundCount)
            mstore(refundAmounts, refundCount)
        }
    }

    function _refundAndCloseNativeMint(BalanceSheet memory sheet, uint256 nativeBaseline)
        private
        returns (
            address[] memory refundTokens,
            uint256[] memory refundAmounts,
            uint256 nativeRefunded
        )
    {
        refundTokens = new address[](sheet.count);
        refundAmounts = new uint256[](sheet.count);
        uint256 refundCount;
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 current = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (current < baseline) revert UnexpectedBalanceDecrease(token, baseline, current);
            uint256 refund = current - baseline;
            if (refund != 0) {
                if (token == weth) {
                    nativeRefunded = refund;
                    IWETH(weth).withdraw(refund);
                    _sendNative(msg.sender, refund);
                } else {
                    refundTokens[refundCount] = token;
                    refundAmounts[refundCount] = refund;
                    refundCount++;
                    _recordCredit(sheet, token, refund);
                    _pushExact(token, msg.sender, refund);
                }
            }
            uint256 closed = IERC20(token).balanceOf(address(this));
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 closed = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        _assertNativeBaseline(nativeBaseline);
        _assertCallerDeltas(sheet, msg.sender);
        assembly ("memory-safe") {
            mstore(refundTokens, refundCount)
            mstore(refundAmounts, refundCount)
        }
    }

    function _wrapExact(uint256 amount) private {
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        IWETH(weth).deposit{ value: amount }();
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        if (wethAfter != wethBefore + amount) {
            revert TokenTransferMismatch(weth, amount, 0, wethAfter - wethBefore);
        }
    }

    function _sendNative(address recipient, uint256 amount) private {
        (bool success,) = payable(recipient).call{ value: amount }("");
        if (!success) revert NativeTransferFailed(recipient, amount);
    }

    function _assertNativeBaseline(uint256 baseline) private view {
        uint256 observed = address(this).balance;
        if (observed != baseline) revert NativeBalanceMismatch(baseline, observed);
    }

    function _refundAmount(
        address[] memory refundTokens,
        uint256[] memory refundAmounts,
        address token
    ) private pure returns (uint256 amount) {
        for (uint256 i = 0; i < refundTokens.length; i++) {
            if (refundTokens[i] == token) return refundAmounts[i];
        }
    }

    function _assertCallerDeltas(BalanceSheet memory sheet, address caller) private view {
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 observed = IERC20(token).balanceOf(caller);
            uint256 debits = sheet.callerDebits[i];
            uint256 credits = sheet.callerCredits[i];
            if (observed + debits != sheet.callerBaselines[i] + credits) {
                revert CallerBalanceMismatch(
                    token, sheet.callerBaselines[i], debits, credits, observed
                );
            }
        }
    }

    function _pullExact(address token, address from, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(from);
        uint256 receiverBefore = IERC20(token).balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(from),
            receiverBefore,
            IERC20(token).balanceOf(address(this))
        );
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        token.safeApprove(spender, amount);
        uint256 observed = IERC20(token).allowance(address(this), spender);
        if (observed != amount) revert ApprovalMismatch(token, spender, amount, observed);
    }

    function _pushExact(address token, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransfer(to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(address(this)),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
    }

    function _verifyTransfer(
        address token,
        uint256 expected,
        uint256 senderBefore,
        uint256 senderAfter,
        uint256 receiverBefore,
        uint256 receiverAfter
    ) private pure {
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != expected || receiverDelta != expected) {
            revert TokenTransferMismatch(token, expected, senderDelta, receiverDelta);
        }
    }
}
