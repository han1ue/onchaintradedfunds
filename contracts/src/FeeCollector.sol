// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FeeCollector {
    error ZeroAddress();

    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);

    address public treasury;

    constructor(address initialTreasury) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
        emit TreasuryChanged(address(0), initialTreasury);
    }
}

