// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { IEntryAdapter } from "./interfaces/IEntryAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IEntryVault {
    function assets() external view returns (address[] memory);

    function previewMint(uint256 shares) external view returns (uint256[] memory amountsIn);

    function mintWithBasket(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        returns (uint256[] memory amountsIn);
}

struct EntrySwap {
    address adapter;
    uint256 maxSettlementIn;
    bytes adapterData;
}

contract OTFEntryRouter {
    using SafeTransferLib for address;

    error NotOwner();
    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error InvalidReceiver(address receiver);
    error InvalidArrayLength();
    error ZeroShares();
    error ZeroMaximumInput();
    error DeadlineExpired(uint256 deadline);
    error UnapprovedEntryAdapter(address adapter);
    error InvalidSettlementLeg(uint256 index);
    error MaximumInputTooLow(uint256 requiredMaximum, uint256 suppliedMaximum);
    error AdapterInputMismatch(uint256 index, uint256 reported, uint256 observed);
    error AdapterOutputMismatch(uint256 index, uint256 expected, uint256 observed);
    error VaultInputMismatch(uint256 index, uint256 expected, uint256 actual);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error Reentrancy();

    event EntryAdapterApprovalChanged(address indexed adapter, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event EnteredWithSettlement(
        address indexed payer,
        address indexed receiver,
        address indexed vault,
        uint256 shares,
        uint256 settlementSpent,
        uint256 settlementRefunded
    );

    address public owner;
    address public immutable factory;
    address public immutable settlementToken;
    mapping(address => bool) public isEntryAdapterApproved;
    bool private _entered;

    constructor(address initialOwner, address factory_, address settlementToken_) {
        if (initialOwner == address(0) || factory_ == address(0) || settlementToken_ == address(0)) {
            revert ZeroAddress();
        }
        if (factory_.code.length == 0) revert InvalidDependency(factory_);
        if (settlementToken_.code.length == 0) revert InvalidDependency(settlementToken_);
        owner = initialOwner;
        factory = factory_;
        settlementToken = settlementToken_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function setEntryAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0) || adapter.code.length == 0) {
            revert InvalidDependency(adapter);
        }
        isEntryAdapterApproved[adapter] = approved;
        emit EntryAdapterApprovalChanged(adapter, approved);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function enterWithSettlement(
        address vault,
        uint256 shares,
        address receiver,
        uint256 maxSettlementIn,
        uint256 deadline,
        EntrySwap[] calldata swaps
    ) external nonReentrant returns (uint256 settlementSpent) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (shares == 0) revert ZeroShares();
        if (maxSettlementIn == 0) revert ZeroMaximumInput();
        if (receiver == address(0) || receiver == address(this) || receiver == vault) {
            revert InvalidReceiver(receiver);
        }
        if (!IAdapterAllowlist(factory).isVault(vault)) revert InvalidVault(vault);

        address[] memory assets = IEntryVault(vault).assets();
        if (swaps.length != assets.length) revert InvalidArrayLength();
        uint256[] memory requiredAmounts = IEntryVault(vault).previewMint(shares);
        if (requiredAmounts.length != assets.length) revert InvalidArrayLength();

        uint256 requiredMaximum;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == settlementToken) {
                if (
                    swaps[i].adapter != address(0) || swaps[i].maxSettlementIn != 0
                        || swaps[i].adapterData.length != 0
                ) {
                    revert InvalidSettlementLeg(i);
                }
                requiredMaximum += requiredAmounts[i];
            } else {
                if (!isEntryAdapterApproved[swaps[i].adapter]) {
                    revert UnapprovedEntryAdapter(swaps[i].adapter);
                }
                requiredMaximum += swaps[i].maxSettlementIn;
            }
        }
        if (requiredMaximum > maxSettlementIn) {
            revert MaximumInputTooLow(requiredMaximum, maxSettlementIn);
        }

        _pullExact(settlementToken, msg.sender, address(this), maxSettlementIn);

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 required = requiredAmounts[i];
            if (asset == settlementToken) {
                settlementSpent += required;
                continue;
            }

            EntrySwap calldata swap = swaps[i];
            uint256 settlementBefore = IERC20(settlementToken).balanceOf(address(this));
            uint256 assetBefore = IERC20(asset).balanceOf(address(this));
            settlementToken.safeApprove(swap.adapter, 0);
            settlementToken.safeApprove(swap.adapter, swap.maxSettlementIn);
            uint256 reportedInput = IEntryAdapter(swap.adapter).buyExactOutput(
                settlementToken,
                asset,
                required,
                swap.maxSettlementIn,
                swap.adapterData
            );
            settlementToken.safeApprove(swap.adapter, 0);

            uint256 settlementAfter = IERC20(settlementToken).balanceOf(address(this));
            uint256 assetAfter = IERC20(asset).balanceOf(address(this));
            uint256 observedInput = settlementBefore - settlementAfter;
            uint256 observedOutput = assetAfter - assetBefore;
            if (reportedInput != observedInput) {
                revert AdapterInputMismatch(i, reportedInput, observedInput);
            }
            if (observedOutput != required) {
                revert AdapterOutputMismatch(i, required, observedOutput);
            }
            settlementSpent += observedInput;
        }

        for (uint256 i = 0; i < assets.length; i++) {
            assets[i].safeApprove(vault, 0);
            assets[i].safeApprove(vault, requiredAmounts[i]);
        }
        uint256[] memory deposited =
            IEntryVault(vault).mintWithBasket(shares, receiver, requiredAmounts);
        if (deposited.length != requiredAmounts.length) revert InvalidArrayLength();
        for (uint256 i = 0; i < assets.length; i++) {
            assets[i].safeApprove(vault, 0);
            if (deposited[i] != requiredAmounts[i]) {
                revert VaultInputMismatch(i, requiredAmounts[i], deposited[i]);
            }
        }

        uint256 refund = maxSettlementIn - settlementSpent;
        if (refund != 0) _pushExact(settlementToken, msg.sender, refund);
        emit EnteredWithSettlement(msg.sender, receiver, vault, shares, settlementSpent, refund);
    }

    function _pullExact(address token, address from, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(from);
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(from),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
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
