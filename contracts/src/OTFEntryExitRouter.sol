// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
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
    uint256 inputAmount;
    uint256 minAssetOut;
    uint256 minRefundInputRate;
    bytes adapterData;
    bytes refundAdapterData;
}

struct ExitSwap {
    address adapter;
    uint256 minOutputAmount;
    bytes adapterData;
}

contract OTFEntryExitRouter {
    using SafeTransferLib for address;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidVault(address vault);
    error ProtocolDepositsPaused();
    error VaultDepositsPaused(address vault);
    error InvalidReceiver(address receiver);
    error InvalidArrayLength();
    error ZeroShares();
    error ZeroInputAmount();
    error ZeroMinimumOutput();
    error DeadlineExpired(uint256 deadline);
    error UnapprovedTradeAdapter(address adapter);
    error InvalidDirectLeg(uint256 index);
    error InputAmountMismatch(uint256 expected, uint256 actual);
    error AdapterOutputMismatch(uint256 index, uint256 expected, uint256 observed);
    error VaultInputMismatch(uint256 index, uint256 expected, uint256 actual);
    error VaultOutputMismatch(uint256 index, uint256 reported, uint256 observed);
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error Reentrancy();

    event EnteredWithToken(
        address indexed payer,
        address indexed receiver,
        address indexed vault,
        address inputToken,
        uint256 inputAmount,
        uint256 shares,
        uint256 inputRefunded
    );
    event RedeemedToToken(
        address indexed owner,
        address indexed receiver,
        address indexed vault,
        address outputToken,
        uint256 shares,
        uint256 outputReceived
    );

    address public immutable factory;
    bool private _entered;
    uint256 private constant REFUND_RATE_SCALE = 1e18;

    constructor(address factory_) {
        if (factory_ == address(0)) revert ZeroAddress();
        if (factory_.code.length == 0) revert InvalidDependency(factory_);
        factory = factory_;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Spends a fixed input-token amount and mints the largest proportional OTF basket.
    /// @dev Any constituent amounts above the limiting basket ratio are sold back to inputToken.
    function enterWithToken(
        address vault,
        address inputToken,
        uint256 inputAmount,
        uint256 minShares,
        address receiver,
        uint256 deadline,
        EntrySwap[] calldata swaps
    ) external nonReentrant returns (uint256 shares, uint256 inputRefunded) {
        // User-supplied swap deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (inputToken == address(0)) revert ZeroAddress();
        if (inputToken.code.length == 0) revert InvalidDependency(inputToken);
        if (inputAmount == 0) revert ZeroInputAmount();
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
        uint256 allocatedInput;
        for (uint256 i = 0; i < assets.length; i++) {
            EntrySwap calldata swap = swaps[i];
            allocatedInput += swap.inputAmount;
            if (assets[i] == inputToken) {
                if (
                    swap.adapter != address(0) || swap.minAssetOut != swap.inputAmount
                        || swap.minRefundInputRate != 0 || swap.adapterData.length != 0
                        || swap.refundAdapterData.length != 0
                ) {
                    revert InvalidDirectLeg(i);
                }
            } else if (!IAdapterAllowlist(factory)
                    .isAdapterApproved(swap.adapter, IAdapterAllowlist.AdapterApprovalType.Entry)) {
                revert UnapprovedTradeAdapter(swap.adapter);
            } else if (swap.inputAmount != 0 && swap.minRefundInputRate == 0) {
                revert ZeroMinimumOutput();
            }
        }
        if (allocatedInput != inputAmount) {
            revert InputAmountMismatch(inputAmount, allocatedInput);
        }

        // Fund and verify the complete atomic entry before any swaps or share minting. The
        // reentrancy guard blocks callbacks, and any later failure reverts the pull and all swaps.
        _pullExact(inputToken, msg.sender, address(this), inputAmount);
        uint256[] memory availableAmounts = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            EntrySwap calldata swap = swaps[i];
            if (assets[i] == inputToken) {
                availableAmounts[i] = swap.inputAmount;
                continue;
            }
            if (swap.inputAmount == 0) continue;

            _pushExact(inputToken, swap.adapter, swap.inputAmount);
            uint256 assetBefore = IERC20(assets[i]).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(
                    inputToken, assets[i], swap.inputAmount, swap.minAssetOut, swap.adapterData
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
        inputRefunded = _convertRefundsToInputToken(inputToken, assets, refunds, swaps);
        if (inputRefunded != 0) {
            _pushExact(inputToken, msg.sender, inputRefunded);
        }
        emit EnteredWithToken(
            msg.sender, receiver, vault, inputToken, inputAmount, shares, inputRefunded
        );
    }

    function _convertRefundsToInputToken(
        address inputToken,
        address[] memory assets,
        uint256[] memory refunds,
        EntrySwap[] calldata swaps
    ) private returns (uint256 inputRefunded) {
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 refund = refunds[i];
            if (refund == 0) continue;
            if (assets[i] == inputToken) {
                inputRefunded += refund;
                continue;
            }

            EntrySwap calldata swap = swaps[i];
            uint256 minInputOut = Math.mulDiv(refund, swap.minRefundInputRate, REFUND_RATE_SCALE);
            _pushExact(assets[i], swap.adapter, refund);
            uint256 inputBefore = IERC20(inputToken).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(assets[i], inputToken, refund, minInputOut, swap.refundAdapterData);
            uint256 observedOutput = IERC20(inputToken).balanceOf(address(this)) - inputBefore;
            if (reportedOutput != observedOutput) {
                revert AdapterOutputMismatch(i, reportedOutput, observedOutput);
            }
            if (observedOutput < minInputOut) {
                revert MinimumOutputNotMet(minInputOut, observedOutput);
            }
            inputRefunded += observedOutput;
        }
    }

    function redeemToToken(
        address vault,
        address outputToken,
        uint256 shares,
        address receiver,
        uint256 minOutputAmount,
        uint256 deadline,
        ExitSwap[] calldata swaps
    ) external nonReentrant returns (uint256 outputReceived) {
        // User-supplied swap deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (outputToken == address(0)) revert ZeroAddress();
        if (outputToken.code.length == 0) revert InvalidDependency(outputToken);
        if (shares == 0) revert ZeroShares();
        if (minOutputAmount == 0) revert ZeroMinimumOutput();
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
            if (asset == outputToken) {
                if (
                    swaps[i].adapter != address(0) || swaps[i].minOutputAmount != 0
                        || swaps[i].adapterData.length != 0
                ) {
                    revert InvalidDirectLeg(i);
                }
            } else if (!IAdapterAllowlist(factory)
                    .isAdapterApproved(
                        swaps[i].adapter, IAdapterAllowlist.AdapterApprovalType.Exit
                    )) {
                revert UnapprovedTradeAdapter(swaps[i].adapter);
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
            if (asset == outputToken) {
                outputReceived += amount;
                continue;
            }

            ExitSwap calldata swap = swaps[i];
            if (amount == 0) {
                if (swap.minOutputAmount != 0) {
                    revert MinimumOutputNotMet(swap.minOutputAmount, 0);
                }
                continue;
            }
            _pushExact(asset, swap.adapter, amount);
            uint256 outputBefore = IERC20(outputToken).balanceOf(address(this));
            uint256 reportedOutput = ITradeAdapter(swap.adapter)
                .executeSwap(asset, outputToken, amount, swap.minOutputAmount, swap.adapterData);
            uint256 observedOutput = IERC20(outputToken).balanceOf(address(this)) - outputBefore;
            if (reportedOutput != observedOutput) {
                revert AdapterOutputMismatch(i, reportedOutput, observedOutput);
            }
            if (observedOutput < swap.minOutputAmount) {
                revert MinimumOutputNotMet(swap.minOutputAmount, observedOutput);
            }
            outputReceived += observedOutput;
        }

        if (outputReceived < minOutputAmount) {
            revert MinimumOutputNotMet(minOutputAmount, outputReceived);
        }
        _pushExact(outputToken, receiver, outputReceived);
        emit RedeemedToToken(msg.sender, receiver, vault, outputToken, shares, outputReceived);
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
