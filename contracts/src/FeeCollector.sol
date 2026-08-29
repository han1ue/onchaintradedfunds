// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";

contract FeeCollector {
    using SafeTransferLib for address;

    error ZeroAddress();
    error NotTreasury();
    error NotPendingTreasury();
    error Reentrancy();
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );

    event TreasuryTransferStarted(address indexed currentTreasury, address indexed pendingTreasury);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TokenClaimed(address indexed token, address indexed treasury, uint256 amount);

    address public treasury;
    address public pendingTreasury;
    bool private _entered;

    constructor(address initialTreasury) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
        emit TreasuryChanged(address(0), initialTreasury);
    }

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
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

    function claim(address token, uint256 amount) external onlyTreasury nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        _claimExact(token, amount);
        emit TokenClaimed(token, treasury, amount);
    }

    function claimAll(address token) external onlyTreasury nonReentrant returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        amount = IERC20(token).balanceOf(address(this));
        _claimExact(token, amount);
        emit TokenClaimed(token, treasury, amount);
    }

    function _claimExact(address token, uint256 amount) private {
        address receiver = treasury;
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 receiverBefore = IERC20(token).balanceOf(receiver);
        if (amount != 0) token.safeTransfer(receiver, amount);
        uint256 senderAfter = IERC20(token).balanceOf(address(this));
        uint256 receiverAfter = IERC20(token).balanceOf(receiver);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert TokenTransferMismatch(token, amount, senderDelta, receiverDelta);
        }
    }
}
