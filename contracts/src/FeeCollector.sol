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
        if (amount != 0) token.safeTransfer(treasury, amount);
        emit TokenClaimed(token, treasury, amount);
    }

    function claimAll(address token) external onlyTreasury nonReentrant returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        amount = IERC20(token).balanceOf(address(this));
        if (amount != 0) token.safeTransfer(treasury, amount);
        emit TokenClaimed(token, treasury, amount);
    }
}
