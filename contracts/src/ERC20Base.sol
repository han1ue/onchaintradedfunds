// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";

abstract contract ERC20Base is IERC20Metadata {
    error ERC20AlreadyInitialized();
    error ERC20InsufficientBalance(address account, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InvalidSender(address sender);

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool private _erc20Initialized;

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function _initializeERC20(string memory name_, string memory symbol_, uint8 decimals_) internal {
        if (_erc20Initialized) revert ERC20AlreadyInitialized();
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        _erc20Initialized = true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(from);
        if (to == address(0)) revert ERC20InvalidReceiver(to);

        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert ERC20InsufficientBalance(from, fromBalance, value);

        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        if (to == address(0)) revert ERC20InvalidReceiver(to);
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(from);
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert ERC20InsufficientBalance(from, fromBalance, value);

        unchecked {
            balanceOf[from] = fromBalance - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 currentAllowance = allowance[owner][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < value) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, value);
            }
            unchecked {
                allowance[owner][spender] = currentAllowance - value;
            }
            emit Approval(owner, spender, allowance[owner][spender]);
        }
    }
}

