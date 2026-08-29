// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Configurable ERC-20 test double for exercising approval and balance-delta defenses.
contract MockAdversarialERC20 {
    enum TransferMutation {
        None,
        TouchedBalanceRebase
    }

    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidReceiver();

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    TransferMutation public transferMutation;
    uint256 public mutationAmount;
    bool public ignoreApprovals;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function setTransferMutation(TransferMutation mutation, uint256 amount) external {
        transferMutation = mutation;
        mutationAmount = amount;
    }

    function setIgnoreApprovals(bool ignored) external {
        ignoreApprovals = ignored;
    }

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert InvalidReceiver();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[from] = balance - amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (!ignoreApprovals) {
            allowance[msg.sender][spender] = amount;
            emit Approval(msg.sender, spender, amount);
        }
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

        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);

        if (transferMutation == TransferMutation.TouchedBalanceRebase && mutationAmount != 0) {
            balanceOf[from] += mutationAmount;
            balanceOf[to] += mutationAmount;
            totalSupply += mutationAmount * 2;
            emit Transfer(address(0), from, mutationAmount);
            emit Transfer(address(0), to, mutationAmount);
        }
    }
}
