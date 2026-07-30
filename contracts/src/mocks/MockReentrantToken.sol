// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../ERC20Base.sol";

contract MockReentrantToken is ERC20Base {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    bool public callbackSucceeded;
    bool private _insideCallback;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        _initializeERC20(name_, symbol_, decimals_);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureCallback(address target, bytes calldata data, bool enabled) external {
        callbackTarget = target;
        callbackData = data;
        callbackEnabled = enabled;
        callbackSucceeded = false;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        _attemptCallback();
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        external
        override
        returns (bool)
    {
        _spendAllowance(from, msg.sender, value);
        _attemptCallback();
        _transfer(from, to, value);
        return true;
    }

    function _attemptCallback() private {
        if (!callbackEnabled || _insideCallback) return;
        _insideCallback = true;
        (callbackSucceeded,) = callbackTarget.call(callbackData);
        _insideCallback = false;
    }
}
