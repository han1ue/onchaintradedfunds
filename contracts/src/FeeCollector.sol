// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

contract FeeCollector {
    using SafeTransferLib for address;

    uint16 public constant BPS = 10_000;

    error ZeroAddress();
    error NotTreasury();
    error NotPendingTreasury();
    error InvalidBuybackAllocation(uint16 allocationBps);
    error BuybackRecipientRequired();

    event TreasuryTransferStarted(address indexed currentTreasury, address indexed pendingTreasury);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TokenClaimed(address indexed token, address indexed treasury, uint256 amount);
    event BuybackConfigChanged(address indexed recipient, uint16 allocationBps);
    event BuybackFunded(address indexed token, address indexed recipient, uint256 amount);

    address public treasury;
    address public pendingTreasury;
    address public buybackRecipient;
    uint16 public buybackAllocationBps;

    constructor(address initialTreasury) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
        emit TreasuryChanged(address(0), initialTreasury);
    }

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    function beginTreasuryTransfer(address newTreasury) external onlyTreasury {
        if (newTreasury == address(0)) revert ZeroAddress();
        pendingTreasury = newTreasury;
        emit TreasuryTransferStarted(treasury, newTreasury);
    }

    function acceptTreasuryTransfer() external {
        if (msg.sender != pendingTreasury) revert NotPendingTreasury();
        address oldTreasury = treasury;
        treasury = msg.sender;
        pendingTreasury = address(0);
        emit TreasuryChanged(oldTreasury, msg.sender);
    }

    /// @notice Allocates a percentage of every subsequent claim to the buyback contract.
    /// @dev Setting the allocation to zero disables funding. Claiming remains treasury-triggered.
    function setBuybackConfig(address recipient, uint16 allocationBps) external onlyTreasury {
        if (allocationBps > BPS) revert InvalidBuybackAllocation(allocationBps);
        if (allocationBps != 0 && recipient == address(0)) revert BuybackRecipientRequired();
        buybackRecipient = recipient;
        buybackAllocationBps = allocationBps;
        emit BuybackConfigChanged(recipient, allocationBps);
    }

    function claim(address token, uint256 amount) external onlyTreasury {
        if (token == address(0)) revert ZeroAddress();
        _distribute(token, amount);
    }

    function claimAll(address token) external onlyTreasury returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        amount = IERC20(token).balanceOf(address(this));
        _distribute(token, amount);
    }

    function _distribute(address token, uint256 amount) private {
        uint256 buybackAmount = MathEx.mulDiv(amount, buybackAllocationBps, BPS);
        uint256 treasuryAmount = amount - buybackAmount;
        address recipient = buybackRecipient;

        if (buybackAmount != 0) token.safeTransfer(recipient, buybackAmount);
        if (treasuryAmount != 0) token.safeTransfer(treasury, treasuryAmount);

        emit BuybackFunded(token, recipient, buybackAmount);
        emit TokenClaimed(token, treasury, treasuryAmount);
    }
}
