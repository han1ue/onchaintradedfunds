// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../interfaces/IERC20.sol";

library SafeTransferLib {
    error SafeTransferFailed();
    error SafeTransferFromFailed();
    error SafeApproveFailed();

    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeTransferFailed();
        }
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeTransferFromFailed();
        }
    }

    function safeApprove(address token, address spender, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeApproveFailed();
        }
    }
}

