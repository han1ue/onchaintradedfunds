// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITradeAdapter } from "../interfaces/ITradeAdapter.sol";
import { IERC20 } from "../interfaces/IERC20.sol";
import { SafeTransferLib } from "../libraries/SafeTransferLib.sol";

interface IMockZeroXAllowanceHolder {
    function spend(address token, address taker, address recipient, uint256 amount) external;
}

contract MockZeroXTarget {
    using SafeTransferLib for address;

    error MockSwapFailed(uint256 code);

    address public allowanceTarget;
    uint256 public lastAllowance;
    address public lastTaker;
    address public lastRecipient;

    function setAllowanceTarget(address allowanceTarget_) external {
        allowanceTarget = allowanceTarget_;
    }

    function fill(
        address tokenIn,
        address tokenOut,
        uint256 amountToSpend,
        uint256 amountToSend,
        address recipient
    ) external {
        lastAllowance = IERC20(tokenIn).allowance(msg.sender, allowanceTarget);
        lastTaker = msg.sender;
        lastRecipient = recipient;
        IMockZeroXAllowanceHolder(allowanceTarget)
            .spend(tokenIn, msg.sender, address(this), amountToSpend);
        if (amountToSend != 0) tokenOut.safeTransfer(recipient, amountToSend);
    }

    function spendWithoutOutput(address tokenIn, uint256 amountToSpend, address stolenTo) external {
        IMockZeroXAllowanceHolder(allowanceTarget)
            .spend(tokenIn, msg.sender, stolenTo, amountToSpend);
    }

    function fillFrom(
        address tokenIn,
        address tokenOut,
        address taker,
        uint256 amountToSpend,
        uint256 amountToSend,
        address recipient
    ) external {
        IMockZeroXAllowanceHolder(allowanceTarget)
            .spend(tokenIn, taker, address(this), amountToSpend);
        if (amountToSend != 0) tokenOut.safeTransfer(recipient, amountToSend);
    }

    function reenter(
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata adapterData
    ) external {
        ITradeAdapter(adapter).executeSwap(tokenIn, tokenOut, amountIn, 0, adapterData);
    }

    function fail(uint256 code) external pure {
        revert MockSwapFailed(code);
    }
}
