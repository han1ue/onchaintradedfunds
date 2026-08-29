// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockReentrantToken is ERC20 {
    address public callbackTarget;
    address public callbackSender;
    bytes public callbackData;
    bool public callbackEnabled;
    bool public callbackSucceeded;
    bool private _insideCallback;
    uint8 private _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
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

    function configureCallbackSender(address sender) external {
        callbackSender = sender;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        _attemptCallback(to);
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _attemptCallback(to);
        return super.transferFrom(from, to, value);
    }

    function _attemptCallback(address transferRecipient) private {
        if (
            !callbackEnabled || _insideCallback
                || (callbackSender != address(0) && msg.sender != callbackSender)
        ) return;
        _insideCallback = true;
        address target = callbackTarget == address(0) ? transferRecipient : callbackTarget;
        (callbackSucceeded,) = target.call(callbackData);
        _insideCallback = false;
    }
}
