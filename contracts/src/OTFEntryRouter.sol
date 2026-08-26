// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

interface IEntryVault {
    function assets() external view returns (address[] memory);

    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        view
        returns (uint256 shares, uint256[] memory amountsIn);

    function mintWithBasket(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        returns (uint256[] memory amountsIn);

    function redeem(
        uint256 shares,
        address receiver,
        address shareOwner,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory amountsOut);
}

struct EntrySwap {
    address adapter;
    uint256 settlementIn;
    uint256 minAssetOut;
    uint256 minRefundSettlementRate;
    bytes adapterData;
    bytes refundAdapterData;
}

struct ExitSwap {
    address adapter;
    uint256 minSettlementOut;
    bytes adapterData;
}

contract OTFEntryRouter is Ownable2Step {
    using SafeTransferLib for address;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error ProtocolDepositsPaused();
    error VaultDepositsPaused(address vault);
    error InvalidReceiver(address receiver);
    error InvalidArrayLength();
    error ZeroShares();
    error ZeroSettlementInput();
    error ZeroMinimumOutput();
    error DeadlineExpired(uint256 deadline);
    error UnapprovedEntryAdapter(address adapter);
    error InvalidSettlementLeg(uint256 index);
    error SettlementInputMismatch(uint256 expected, uint256 actual);
    error AdapterOutputMismatch(uint256 index, uint256 expected, uint256 observed);
    error VaultInputMismatch(uint256 index, uint256 expected, uint256 actual);
    error VaultOutputMismatch(uint256 index, uint256 reported, uint256 observed);
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error Reentrancy();

    event EntryAdapterApprovalChanged(address indexed adapter, bool approved);
    event EnteredWithSettlement(
        address indexed payer,
        address indexed receiver,
        address indexed vault,
        uint256 settlementIn,
        uint256 shares,
        uint256 settlementRefunded
    );
    event RedeemedToSettlement(
        address indexed owner,
        address indexed receiver,
        address indexed vault,
        uint256 shares,
        uint256 settlementReceived
    );

    address public immutable factory;
    address public immutable settlementToken;
    mapping(address => bool) public isEntryAdapterApproved;
    bool private _entered;
    uint256 private constant REFUND_RATE_SCALE = 1e18;

    constructor(address initialOwner, address factory_, address settlementToken_)
        Ownable(initialOwner)
    {
        if (factory_ == address(0) || settlementToken_ == address(0)) {
            revert ZeroAddress();
        }
        if (factory_.code.length == 0) revert InvalidDependency(factory_);
        if (settlementToken_.code.length == 0) revert InvalidDependency(settlementToken_);
        factory = factory_;
        settlementToken = settlementToken_;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function setEntryAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0) || (approved && adapter.code.length == 0)) {
            revert InvalidDependency(adapter);
        }
        isEntryAdapterApproved[adapter] = approved;
        emit EntryAdapterApprovalChanged(adapter, approved);
    }

    /// @notice Spends a fixed settlement amount and mints the largest proportional OTF basket.
    /// @dev Any constituent amounts above the limiting basket ratio are sold back to settlement.
    function enterWithSettlement(
        address vault,
        uint256 settlementIn,
        uint256 minShares,
        address receiver,
        uint256 deadline,
        EntrySwap[] calldata swaps
    ) external nonReentrant returns (uint256 shares, uint256 settlementRefunded) {
        // User-supplied swap deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (settlementIn == 0) revert ZeroSettlementInput();
        if (minShares == 0) revert ZeroMinimumOutput();
        if (receiver == address(0) || receiver == address(this) || receiver == vault) {
            revert InvalidReceiver(receiver);
        }
        if (!IAdapterAllowlist(factory).isVault(vault)) revert InvalidVault(vault);
        if (IAdapterAllowlist(factory).depositsPaused()) revert ProtocolDepositsPaused();
        if (IAdapterAllowlist(factory).vaultDepositsPaused(vault)) {
            revert VaultDepositsPaused(vault);
        }

        address[] memory assets = IEntryVault(vault).assets();
        if (swaps.length != assets.length) revert InvalidArrayLength();
        uint256 allocatedSettlement;
        for (uint256 i = 0; i < assets.length; i++) {
            EntrySwap calldata swap = swaps[i];
            allocatedSettlement += swap.settlementIn;
            if (assets[i] == settlementToken) {
                if (
                    swap.adapter != address(0) || swap.minAssetOut != swap.settlementIn
                        || swap.minRefundSettlementRate != 0 || swap.adapterData.length != 0
                        || swap.refundAdapterData.length != 0
                ) {
                    revert InvalidSettlementLeg(i);
                }
            } else if (!isEntryAdapterApproved[swap.adapter]) {
                revert UnapprovedEntryAdapter(swap.adapter);
            } else if (swap.settlementIn != 0 && swap.minRefundSettlementRate == 0) {
                revert ZeroMinimumOutput();
            }
        }
        if (allocatedSettlement != settlementIn) {
            revert SettlementInputMismatch(settlementIn, allocatedSettlement);
        }

        // Fund and verify the complete atomic entry before any swaps or share minting. The
        // reentrancy guard blocks callbacks, and any later failure reverts the pull and all swaps.
        _pullExact(settlementToken, msg.sender, address(this), settlementIn);
        uint256[] memory availableAmounts = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            EntrySwap calldata swap = swaps[i];
            if (assets[i] == settlementToken) {
                availableAmounts[i] = swap.settlementIn;
                continue;
            }
            if (swap.settlementIn == 0) continue;

            _pushExact(settlementToken, swap.adapter, swap.settlementIn);
            uint256 assetBefore = IERC20(assets[i]).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(
                    settlementToken,
                    assets[i],
                    swap.settlementIn,
                    swap.minAssetOut,
                    swap.adapterData
                );
            uint256 observedOutput = IERC20(assets[i]).balanceOf(address(this)) - assetBefore;
            if (reportedOutput != observedOutput) {
                revert AdapterOutputMismatch(i, reportedOutput, observedOutput);
            }
            if (observedOutput < swap.minAssetOut) {
                revert MinimumOutputNotMet(swap.minAssetOut, observedOutput);
            }
            availableAmounts[i] = observedOutput;
        }

        uint256[] memory requiredAmounts;
        (shares, requiredAmounts) = IEntryVault(vault).previewMaxMint(availableAmounts);
        if (shares < minShares) revert MinimumOutputNotMet(minShares, shares);

        for (uint256 i = 0; i < assets.length; i++) {
            assets[i].safeApprove(vault, 0);
            assets[i].safeApprove(vault, requiredAmounts[i]);
        }
        uint256[] memory deposited =
            IEntryVault(vault).mintWithBasket(shares, receiver, requiredAmounts);
        if (deposited.length != requiredAmounts.length) revert InvalidArrayLength();

        uint256[] memory refunds = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            assets[i].safeApprove(vault, 0);
            if (deposited[i] != requiredAmounts[i]) {
                revert VaultInputMismatch(i, requiredAmounts[i], deposited[i]);
            }
            refunds[i] = availableAmounts[i] - deposited[i];
        }
        settlementRefunded = _convertRefundsToSettlement(assets, refunds, swaps);
        if (settlementRefunded != 0) {
            _pushExact(settlementToken, msg.sender, settlementRefunded);
        }
        emit EnteredWithSettlement(
            msg.sender, receiver, vault, settlementIn, shares, settlementRefunded
        );
    }

    function _convertRefundsToSettlement(
        address[] memory assets,
        uint256[] memory refunds,
        EntrySwap[] calldata swaps
    ) private returns (uint256 settlementRefunded) {
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 refund = refunds[i];
            if (refund == 0) continue;
            if (assets[i] == settlementToken) {
                settlementRefunded += refund;
                continue;
            }

            EntrySwap calldata swap = swaps[i];
            uint256 minSettlementOut =
                Math.mulDiv(refund, swap.minRefundSettlementRate, REFUND_RATE_SCALE);
            _pushExact(assets[i], swap.adapter, refund);
            uint256 settlementBefore = IERC20(settlementToken).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(
                    assets[i], settlementToken, refund, minSettlementOut, swap.refundAdapterData
                );
            uint256 observedOutput =
                IERC20(settlementToken).balanceOf(address(this)) - settlementBefore;
            if (reportedOutput != observedOutput) {
                revert AdapterOutputMismatch(i, reportedOutput, observedOutput);
            }
            if (observedOutput < minSettlementOut) {
                revert MinimumOutputNotMet(minSettlementOut, observedOutput);
            }
            settlementRefunded += observedOutput;
        }
    }

    function redeemToSettlement(
        address vault,
        uint256 shares,
        address receiver,
        uint256 minSettlementOut,
        uint256 deadline,
        ExitSwap[] calldata swaps
    ) external nonReentrant returns (uint256 settlementReceived) {
        // User-supplied swap deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (shares == 0) revert ZeroShares();
        if (minSettlementOut == 0) revert ZeroMinimumOutput();
        if (receiver == address(0) || receiver == address(this) || receiver == vault) {
            revert InvalidReceiver(receiver);
        }
        if (!IAdapterAllowlist(factory).isVault(vault)) revert InvalidVault(vault);

        address[] memory assets = IEntryVault(vault).assets();
        if (swaps.length != assets.length) revert InvalidArrayLength();
        uint256[] memory balancesBefore = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            balancesBefore[i] = IERC20(asset).balanceOf(address(this));
            if (asset == settlementToken) {
                if (
                    swaps[i].adapter != address(0) || swaps[i].minSettlementOut != 0
                        || swaps[i].adapterData.length != 0
                ) {
                    revert InvalidSettlementLeg(i);
                }
            } else if (!isEntryAdapterApproved[swaps[i].adapter]) {
                revert UnapprovedEntryAdapter(swaps[i].adapter);
            }
        }

        uint256[] memory minimums = new uint256[](assets.length);
        uint256[] memory redeemed =
            IEntryVault(vault).redeem(shares, address(this), msg.sender, minimums);
        if (redeemed.length != assets.length) revert InvalidArrayLength();

        uint256[] memory observedRedeemed = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 observed = IERC20(assets[i]).balanceOf(address(this)) - balancesBefore[i];
            if (redeemed[i] != observed) {
                revert VaultOutputMismatch(i, redeemed[i], observed);
            }
            observedRedeemed[i] = observed;
        }

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 amount = observedRedeemed[i];
            if (asset == settlementToken) {
                settlementReceived += amount;
                continue;
            }

            ExitSwap calldata swap = swaps[i];
            if (amount == 0) {
                if (swap.minSettlementOut != 0) {
                    revert MinimumOutputNotMet(swap.minSettlementOut, 0);
                }
                continue;
            }
            _pushExact(asset, swap.adapter, amount);
            uint256 settlementBefore = IERC20(settlementToken).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(
                    asset, settlementToken, amount, swap.minSettlementOut, swap.adapterData
                );
            uint256 observedOutput =
                IERC20(settlementToken).balanceOf(address(this)) - settlementBefore;
            if (reportedOutput != observedOutput) {
                revert AdapterOutputMismatch(i, reportedOutput, observedOutput);
            }
            if (observedOutput < swap.minSettlementOut) {
                revert MinimumOutputNotMet(swap.minSettlementOut, observedOutput);
            }
            settlementReceived += observedOutput;
        }

        if (settlementReceived < minSettlementOut) {
            revert MinimumOutputNotMet(minSettlementOut, settlementReceived);
        }
        _pushExact(settlementToken, receiver, settlementReceived);
        emit RedeemedToSettlement(msg.sender, receiver, vault, shares, settlementReceived);
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
