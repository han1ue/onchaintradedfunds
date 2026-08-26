// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "../../src/interfaces/IERC20.sol";

contract MockFeeOnTransferToken is IERC20Metadata {
    error InvalidFee();
    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidReceiver();

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint16 public feeBps;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function setFeeBps(uint16 feeBps_) external {
        if (feeBps_ > 10_000) revert InvalidFee();
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert InvalidReceiver();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidReceiver();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();

        uint256 fee = amount * feeBps / 10_000;
        uint256 received = amount - fee;
        balanceOf[from] = balance - amount;
        balanceOf[to] += received;
        totalSupply -= fee;
        emit Transfer(from, to, received);
        if (fee != 0) emit Transfer(from, address(0), fee);
    }
}

