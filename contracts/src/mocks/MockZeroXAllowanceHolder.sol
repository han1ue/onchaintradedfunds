// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeTransferLib } from "../libraries/SafeTransferLib.sol";

contract MockZeroXAllowanceHolder {
    using SafeTransferLib for address;

    error UnauthorizedTarget(address caller);

    address public immutable target;

    constructor(address target_) {
        target = target_;
    }

    function spend(address token, address taker, address recipient, uint256 amount) external {
        if (msg.sender != target) revert UnauthorizedTarget(msg.sender);
        token.safeTransferFrom(taker, recipient, amount);
    }
}
