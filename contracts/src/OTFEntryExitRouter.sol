// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IOTFSettlementFactory, IOTFSettlementVault } from "./interfaces/IOTFSettlement.sol";
import { IUniswapV3Factory, IUniswapV3PoolImmutables } from "./interfaces/IUniswapV3Factory.sol";
import { IUniswapV3SwapRouter } from "./interfaces/IUniswapV3SwapRouter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { UniswapV3Path } from "./libraries/UniswapV3Path.sol";

struct V3Swap {
    /// @dev `type(uint256).max` spends the complete transient balance of the path input token.
    uint256 amountIn;
    uint256 minAmountOut;
    /// @dev Standard `token,fee,token...` tuple data. Every byte/hop is parsed and authenticated;
    ///      this is not Universal Router command data or arbitrary calldata.
    bytes path;
}

struct DirectSwapRequest {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    uint256 deadline;
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

/// @notice Permissionless atomic OTF routing through an immutable factory-authenticated V3 venue.
/// @dev Route discovery and quote comparison are offchain. This contract only validates and
///      executes the caller's typed route; it never claims that route is globally optimal.
contract OTFEntryExitRouter {
    using SafeTransferLib for address;

    uint256 public constant MAX_CONSTITUENTS = 20;
    uint256 public constant MAX_LEGS = 40;
    uint256 public constant MAX_HOPS_PER_LEG = 3;
    /// @dev A successful flow begins with at most 20 source assets and each leg can introduce
    ///      at most three new identities. The two vault share tokens are also tracked.
    uint256 public constant MAX_TRACKED_TOKENS = 2 + MAX_CONSTITUENTS + MAX_LEGS * MAX_HOPS_PER_LEG;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error InvalidRouteKind();
    error InvalidArrayLength();
    error InvalidAmount();
    error ZeroMinimumOutput();
    error DeadlineExpired(uint256 deadline);
    error TooManyLegs(uint256 supplied, uint256 maximum);
    error TooManyHops(uint256 supplied, uint256 maximum);
    error TooManyRouteTokens(uint256 maximum);
    error InvalidPath(uint256 leg);
    error ForbiddenRouteToken(address token);
    error DuplicateAsset(address asset);
    error UnauthenticatedPool(address token0, address token1, uint24 fee, address pool);
    error RouterFactoryMismatch(address expected, address observed);
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
    error Reentrancy();

    event DirectSwapExecuted(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 grossAmountIn,
        uint256 inputRefunded,
        uint256 amountOut
    );
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

    struct BalanceSheet {
        address[] tokens;
        uint256[] baselines;
        uint256[] callerBaselines;
        uint256[] callerDebits;
        uint256[] callerCredits;
        uint256 count;
    }

    address public immutable factory;
    address public immutable uniswapV3Factory;
    address public immutable uniswapV3Router;
    bool private _entered;

    constructor(address factory_, address uniswapV3Factory_, address uniswapV3Router_) {
        _requireContract(factory_);
        _requireContract(uniswapV3Factory_);
        _requireContract(uniswapV3Router_);
        address routerFactory = IUniswapV3SwapRouter(uniswapV3Router_).factory();
        if (routerFactory != uniswapV3Factory_) {
            revert RouterFactoryMismatch(uniswapV3Factory_, routerFactory);
        }
        factory = factory_;
        uniswapV3Factory = uniswapV3Factory_;
        uniswapV3Router = uniswapV3Router_;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Swaps a fixed maximum input through direct OTF liquidity, refunding unused input.
    /// @dev At least one endpoint must be a factory-created OTF. Every leg is an authenticated
    ///      standard packed V3 path and every venue output remains here until final settlement.
    function swapDirect(DirectSwapRequest calldata request, V3Swap[] calldata legs)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _validateCommon(
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            request.minAmountOut,
            request.deadline
        );
        bool inputIsVault = IOTFSettlementFactory(factory).isVault(request.tokenIn);
        bool outputIsVault = IOTFSettlementFactory(factory).isVault(request.tokenOut);
        if (!inputIsVault && !outputIsVault) revert InvalidRouteKind();
        if (legs.length == 0) revert InvalidArrayLength();

        BalanceSheet memory sheet = _newBalanceSheet();
        _addToken(sheet, request.tokenIn);
        _addToken(sheet, request.tokenOut);
        _prepareLegs(sheet, legs, address(0), address(0));
        _snapshot(sheet);

        _recordDebit(sheet, request.tokenIn, request.amountIn);
        _pullExact(request.tokenIn, msg.sender, request.amountIn);
        _executeLegs(sheet, legs);
        amountOut = _transientBalance(sheet, request.tokenOut);
        if (amountOut < request.minAmountOut) {
            revert MinimumOutputNotMet(request.minAmountOut, amountOut);
        }
        _recordCredit(sheet, request.tokenOut, amountOut);
        _pushExact(request.tokenOut, msg.sender, amountOut);
        // Capture the exact tokenIn balance before cleanup refunds it. This is intentionally not
        // derived as gross input minus refund because a valid route can produce additional tokenIn.
        uint256 inputRefunded = _transientBalance(sheet, request.tokenIn);
        _refundAndClose(sheet, msg.sender);

        emit DirectSwapExecuted(
            msg.sender,
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            inputRefunded,
            amountOut
        );
    }

    /// @notice Acquires a basket with typed V3 legs and atomically mints the maximum OTF shares.
    function mintFromToken(BasketMintRequest calldata request, V3Swap[] calldata legs)
        external
        nonReentrant
        returns (uint256 shares, uint256 inputRefunded)
    {
        _validateMintRequest(request);
        address[] memory assets = _validatedAssets(request.vault);

        BalanceSheet memory sheet = _newBalanceSheet();
        _addToken(sheet, request.inputToken);
        _addToken(sheet, request.vault);
        _addAssets(sheet, assets);
        _prepareLegs(sheet, legs, request.vault, address(0));
        IOTFSettlementVault(request.vault).checkpointFees();
        _snapshot(sheet);

        _recordDebit(sheet, request.inputToken, request.amountIn);
        _pullExact(request.inputToken, msg.sender, request.amountIn);
        _executeLegs(sheet, legs);
        shares = _mintMaximum(request.vault, assets, request.minShares, sheet);
        inputRefunded = _transientBalance(sheet, request.inputToken);
        _refundAndClose(sheet, msg.sender);

        emit BasketMinted(
            msg.sender, request.vault, request.inputToken, request.amountIn, shares, inputRefunded
        );
    }

    /// @notice Redeems an OTF basket, liquidates through typed V3 legs, and pays one token.
    function redeemToToken(
        BasketRedeemRequest calldata request,
        uint256[] calldata minBasketAmounts,
        V3Swap[] calldata legs
    ) external nonReentrant returns (uint256 amountOut) {
        _validateRedeemRequest(request);
        address[] memory assets = _validatedAssets(request.vault);
        if (minBasketAmounts.length != assets.length) revert InvalidArrayLength();

        BalanceSheet memory sheet = _newBalanceSheet();
        _addToken(sheet, request.vault);
        _addToken(sheet, request.outputToken);
        _addAssets(sheet, assets);
        _prepareLegs(sheet, legs, request.vault, address(0));
        IOTFSettlementVault(request.vault).checkpointFees();
        _snapshot(sheet);

        _recordDebit(sheet, request.vault, request.shares);
        _redeemBasket(request.vault, assets, request.shares, msg.sender, minBasketAmounts);
        _executeLegs(sheet, legs);
        _requireOnlyOutput(sheet, request.outputToken);
        amountOut = _transientBalance(sheet, request.outputToken);
        if (amountOut < request.minAmountOut) {
            revert MinimumOutputNotMet(request.minAmountOut, amountOut);
        }
        _recordCredit(sheet, request.outputToken, amountOut);
        _pushExact(request.outputToken, msg.sender, amountOut);
        // The output token transfer is an external call and may inject a constituent back into
        // the router. Re-assert complete liquidation before any residual balance can be refunded.
        _requireOnlyOutput(sheet, request.outputToken);
        _refundAndClose(sheet, msg.sender);

        emit BasketRedeemed(
            msg.sender, request.vault, request.outputToken, request.shares, amountOut
        );
    }

    /// @notice Atomically redeems one OTF basket, routes constituents, and mints another OTF.
    function swapBasketToBasket(
        BasketSwapRequest calldata request,
        uint256[] calldata minSourceAmounts,
        V3Swap[] calldata legs
    ) external nonReentrant returns (uint256 sharesOut) {
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
        _refundAndClose(sheet, msg.sender);

        emit BasketSwapped(
            msg.sender, request.sourceVault, request.targetVault, request.sharesIn, sharesOut
        );
    }

    function _validateMintRequest(BasketMintRequest calldata request) private view {
        _validateDeadline(request.deadline);
        _requireToken(request.inputToken);
        _requireVault(request.vault);
        if (request.inputToken == request.vault) revert InvalidRouteKind();
        if (request.amountIn == 0) revert InvalidAmount();
        if (request.minShares == 0) revert ZeroMinimumOutput();
    }

    function _validateRedeemRequest(BasketRedeemRequest calldata request) private view {
        _validateDeadline(request.deadline);
        _requireVault(request.vault);
        _requireToken(request.outputToken);
        if (request.outputToken == request.vault) revert InvalidRouteKind();
        if (IOTFSettlementFactory(factory).isVault(request.outputToken)) revert InvalidRouteKind();
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

    function _validateCommon(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimum,
        uint256 deadline
    ) private view {
        _validateDeadline(deadline);
        _requireToken(tokenIn);
        _requireToken(tokenOut);
        if (tokenIn == tokenOut) revert InvalidRouteKind();
        if (amountIn == 0) revert InvalidAmount();
        if (minimum == 0) revert ZeroMinimumOutput();
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
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert InvalidDependency(token);
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
        V3Swap[] calldata legs,
        address forbiddenToken0,
        address forbiddenToken1
    ) private view {
        if (legs.length > MAX_LEGS) {
            revert TooManyLegs(legs.length, MAX_LEGS);
        }
        if (legs.length != 0) {
            address observedFactory = IUniswapV3SwapRouter(uniswapV3Router).factory();
            if (observedFactory != uniswapV3Factory) {
                revert RouterFactoryMismatch(uniswapV3Factory, observedFactory);
            }
        }
        for (uint256 i = 0; i < legs.length; i++) {
            V3Swap calldata leg = legs[i];
            if (leg.amountIn == 0 || leg.minAmountOut == 0) revert InvalidAmount();
            uint256 hops = UniswapV3Path.hopCount(leg.path);
            if (hops == 0) revert InvalidPath(i);
            if (hops > MAX_HOPS_PER_LEG) revert TooManyHops(hops, MAX_HOPS_PER_LEG);

            for (uint256 hop = 0; hop <= hops; hop++) {
                address token = UniswapV3Path.tokenAt(leg.path, hop);
                if (token == forbiddenToken0 || token == forbiddenToken1) {
                    revert ForbiddenRouteToken(token);
                }
                _addToken(sheet, token);
                if (hop == hops) continue;
                address nextToken = UniswapV3Path.tokenAt(leg.path, hop + 1);
                uint24 fee = UniswapV3Path.feeAt(leg.path, hop);
                if (token == nextToken || fee == 0) revert InvalidPath(i);
                _authenticatePool(token, nextToken, fee);
            }
            if (UniswapV3Path.tokenAt(leg.path, 0) == UniswapV3Path.tokenAt(leg.path, hops)) {
                revert InvalidPath(i);
            }
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

    function _snapshot(BalanceSheet memory sheet) private view {
        for (uint256 i = 0; i < sheet.count; i++) {
            sheet.baselines[i] = IERC20(sheet.tokens[i]).balanceOf(address(this));
            sheet.callerBaselines[i] = IERC20(sheet.tokens[i]).balanceOf(msg.sender);
        }
    }

    function _executeLegs(BalanceSheet memory sheet, V3Swap[] calldata legs) private {
        // A route is a bounded directed flow graph, not necessarily one adjacent linear path.
        // Each leg can spend only transient balance pulled from the caller, redeemed from a vault,
        // or produced by an earlier leg. Pre-existing router balances can never fund a leg.
        for (uint256 i = 0; i < legs.length; i++) {
            V3Swap calldata leg = legs[i];
            uint256 hops = UniswapV3Path.hopCount(leg.path);
            address tokenIn = UniswapV3Path.tokenAt(leg.path, 0);
            address tokenOut = UniswapV3Path.tokenAt(leg.path, hops);
            uint256 available = _transientBalance(sheet, tokenIn);
            uint256 amountIn = leg.amountIn == type(uint256).max ? available : leg.amountIn;
            if (amountIn == 0 || amountIn > available) {
                revert InsufficientRouteBalance(tokenIn, available, amountIn);
            }

            uint256 inputBefore = IERC20(tokenIn).balanceOf(address(this));
            uint256 outputBefore = IERC20(tokenOut).balanceOf(address(this));
            _approveExact(tokenIn, uniswapV3Router, 0);
            _approveExact(tokenIn, uniswapV3Router, amountIn);
            uint256 reported = IUniswapV3SwapRouter(uniswapV3Router)
                .exactInput(
                    IUniswapV3SwapRouter.ExactInputParams({
                    path: leg.path,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: leg.minAmountOut
                })
                );
            _approveExact(tokenIn, uniswapV3Router, 0);

            uint256 inputAfter = IERC20(tokenIn).balanceOf(address(this));
            uint256 outputAfter = IERC20(tokenOut).balanceOf(address(this));
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
        uint256 index = _tokenIndex(sheet, token);
        sheet.callerDebits[index] += amount;
    }

    function _recordCredit(BalanceSheet memory sheet, address token, uint256 amount) private pure {
        uint256 index = _tokenIndex(sheet, token);
        sheet.callerCredits[index] += amount;
    }

    function _requireOnlyOutput(BalanceSheet memory sheet, address outputToken) private view {
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            if (token == outputToken) continue;
            uint256 amount = _transientBalance(sheet, token);
            if (amount != 0) revert IncompleteLiquidation(token, amount);
        }
    }

    function _refundAndClose(BalanceSheet memory sheet, address refundRecipient) private {
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 current = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (current < baseline) revert UnexpectedBalanceDecrease(token, baseline, current);
            uint256 refund = current - baseline;
            if (refund != 0) {
                _recordCredit(sheet, token, refund);
                _pushExact(token, refundRecipient, refund);
            }
            uint256 closed = IERC20(token).balanceOf(address(this));
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        // A later refund token may call back and mutate an earlier token that was already checked.
        // Re-check the complete set only after every external refund transfer has finished.
        for (uint256 i = 0; i < sheet.count; i++) {
            address token = sheet.tokens[i];
            uint256 closed = IERC20(token).balanceOf(address(this));
            uint256 baseline = sheet.baselines[i];
            if (closed != baseline) revert ResidualBalance(token, baseline, closed);
        }
        _assertCallerDeltas(sheet, refundRecipient);
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
