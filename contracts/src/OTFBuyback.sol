// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IOTFFeeShareRedeemer {
    function redeem(
        uint256 shares,
        address receiver,
        address shareOwner,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory amountsOut);
}

/// @notice Converts an allocated portion of protocol fee assets into the OTF protocol token.
/// @dev Protocol fee shares can first be redeemed into their basket assets. Operators may then
///      trade only through adapters explicitly approved by the owner, and every trade must buy OTF.
contract OTFBuyback {
    using SafeTransferLib for address;

    error NotOwner();
    error NotPendingOwner();
    error NotOperator();
    error ZeroAddress();
    error InvalidContract(address target);
    error UnapprovedAdapter(address adapter);
    error InvalidTrade();
    error Reentrancy();
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error BuybackOutputMismatch(uint256 reported, uint256 observed);
    error InsufficientBuybackOutput(uint256 received, uint256 minimum);

    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event OperatorApprovalChanged(address indexed operator, bool approved);
    event TradeAdapterApprovalChanged(address indexed adapter, bool approved);
    event FeeSharesRedeemed(address indexed vault, uint256 shares, uint256[] amountsOut);
    event BuybackExecuted(
        address indexed adapter, address indexed tokenIn, uint256 amountIn, uint256 otfAmountOut
    );
    event PurchasedTokensReleased(address indexed recipient, uint256 amount);
    event TokenRecovered(address indexed token, address indexed recipient, uint256 amount);

    address public immutable otfToken;
    address public immutable purchasedTokenRecipient;

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public isOperator;
    mapping(address => bool) public isTradeAdapterApproved;

    bool private _entered;

    constructor(address initialOwner, address otfToken_, address purchasedTokenRecipient_) {
        if (
            initialOwner == address(0) || otfToken_ == address(0)
                || purchasedTokenRecipient_ == address(0)
        ) revert ZeroAddress();
        if (otfToken_.code.length == 0) revert InvalidContract(otfToken_);

        owner = initialOwner;
        otfToken = otfToken_;
        purchasedTokenRecipient = purchasedTokenRecipient_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != owner && !isOperator[msg.sender]) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function beginOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnershipTransfer() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setOperator(address operator, bool approved) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        isOperator[operator] = approved;
        emit OperatorApprovalChanged(operator, approved);
    }

    function setTradeAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (approved && adapter.code.length == 0) revert InvalidContract(adapter);
        isTradeAdapterApproved[adapter] = approved;
        emit TradeAdapterApprovalChanged(adapter, approved);
    }

    /// @notice Redeems protocol fee shares into the OTF's underlying constituent tokens.
    function redeemFeeShares(address vault, uint256 shares, uint256[] calldata minAmountsOut)
        external
        onlyOperator
        nonReentrant
        returns (uint256[] memory amountsOut)
    {
        if (vault == address(0) || vault.code.length == 0) revert InvalidContract(vault);
        if (shares == 0) revert InvalidTrade();

        amountsOut =
            IOTFFeeShareRedeemer(vault).redeem(shares, address(this), address(this), minAmountsOut);
        emit FeeSharesRedeemed(vault, shares, amountsOut);
    }

    /// @notice Trades a fee-derived asset for OTF through an owner-approved adapter.
    function executeBuyback(
        address adapter,
        address tokenIn,
        uint256 amountIn,
        uint256 minOtfOut,
        bytes calldata adapterData
    ) external onlyOperator nonReentrant returns (uint256 amountOut) {
        if (!isTradeAdapterApproved[adapter]) {
            revert UnapprovedAdapter(adapter);
        }
        if (tokenIn == address(0) || tokenIn == otfToken || amountIn == 0 || minOtfOut == 0) {
            revert InvalidTrade();
        }
        if (tokenIn.code.length == 0) revert InvalidContract(tokenIn);

        _pushExact(tokenIn, adapter, amountIn);

        uint256 balanceBefore = IERC20(otfToken).balanceOf(address(this));
        uint256 reportedOutput =
            ITradeAdapter(adapter).executeSwap(tokenIn, otfToken, amountIn, minOtfOut, adapterData);
        amountOut = IERC20(otfToken).balanceOf(address(this)) - balanceBefore;

        if (reportedOutput != amountOut) {
            revert BuybackOutputMismatch(reportedOutput, amountOut);
        }
        if (amountOut < minOtfOut) revert InsufficientBuybackOutput(amountOut, minOtfOut);

        emit BuybackExecuted(adapter, tokenIn, amountIn, amountOut);
    }

    /// @notice Sends purchased OTF to the immutable treasury, timelock, or burn-vault recipient.
    /// @dev This is permissionless because the destination cannot be changed by the caller.
    function releasePurchasedTokens(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidTrade();
        otfToken.safeTransfer(purchasedTokenRecipient, amount);
        emit PurchasedTokensReleased(purchasedTokenRecipient, amount);
    }

    function releaseAllPurchasedTokens() external nonReentrant returns (uint256 amount) {
        amount = IERC20(otfToken).balanceOf(address(this));
        if (amount != 0) otfToken.safeTransfer(purchasedTokenRecipient, amount);
        emit PurchasedTokensReleased(purchasedTokenRecipient, amount);
    }

    /// @notice Recovers an unsupported non-OTF token to the immutable treasury recipient.
    function recoverToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (token == otfToken || amount == 0) revert InvalidTrade();
        token.safeTransfer(purchasedTokenRecipient, amount);
        emit TokenRecovered(token, purchasedTokenRecipient, amount);
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
            revert TokenTransferMismatch(token, amount, senderDelta, receiverDelta);
        }
    }
}
