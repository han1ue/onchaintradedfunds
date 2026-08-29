// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "./interfaces/IERC20.sol";

abstract contract ERC20Base is IERC20Metadata {
    error ERC20AlreadyInitialized();
    error ERC20InsufficientBalance(address account, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InvalidSender(address sender);
    error ERC20NonZeroAllowance(address owner, address spender, uint256 currentAllowance);

    string internal _name;
    string internal _symbol;
    uint8 internal _decimals;
    uint256 internal _totalSupply;

    mapping(address => uint256) internal _balanceOf;
    mapping(address => mapping(address => uint256)) internal _allowance;

    bool private _erc20Initialized;

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _balanceOf[account];
    }

    function allowance(address account, address spender) external view returns (uint256) {
        return _allowance[account][spender];
    }

    function transfer(address to, uint256 value) external virtual returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external virtual returns (bool) {
        uint256 currentAllowance = _allowance[msg.sender][spender];
        if (currentAllowance != 0 && value != 0) {
            revert ERC20NonZeroAllowance(msg.sender, spender, currentAllowance);
        }
        _allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external virtual returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function _initializeERC20(string memory name_, string memory symbol_, uint8 decimals_)
        internal
    {
        if (_erc20Initialized) revert ERC20AlreadyInitialized();
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        _erc20Initialized = true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(from);
        if (to == address(0)) revert ERC20InvalidReceiver(to);

        uint256 fromBalance = _balanceOf[from];
        if (fromBalance < value) revert ERC20InsufficientBalance(from, fromBalance, value);

        unchecked {
            _balanceOf[from] = fromBalance - value;
            _balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        if (to == address(0)) revert ERC20InvalidReceiver(to);
        _totalSupply += value;
        unchecked {
            _balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(from);
        uint256 fromBalance = _balanceOf[from];
        if (fromBalance < value) revert ERC20InsufficientBalance(from, fromBalance, value);

        unchecked {
            _balanceOf[from] = fromBalance - value;
            _totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 currentAllowance = _allowance[owner][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < value) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, value);
            }
            unchecked {
                _allowance[owner][spender] = currentAllowance - value;
            }
            emit Approval(owner, spender, _allowance[owner][spender]);
        }
    }
}
