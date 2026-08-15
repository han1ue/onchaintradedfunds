// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IUniswapV3SwapRouter } from "../UniswapV3Adapter.sol";
import { SafeTransferLib } from "../libraries/SafeTransferLib.sol";

contract MockUniswapV3Router is IUniswapV3SwapRouter {
    using SafeTransferLib for address;

    uint256 public reportedOutputBonus;

    function setReportedOutputBonus(uint256 bonus) external {
        reportedOutputBonus = bonus;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(params.amountIn >= params.amountOutMinimum, "SLIPPAGE");
        params.tokenIn.safeTransferFrom(msg.sender, address(this), params.amountIn);
        params.tokenOut.safeTransfer(params.recipient, params.amountIn);
        return params.amountIn + reportedOutputBonus;
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        address tokenIn = _firstToken(params.path);
        address tokenOut = _lastToken(params.path);
        require(params.amountIn >= params.amountOutMinimum, "SLIPPAGE");
        tokenIn.safeTransferFrom(msg.sender, address(this), params.amountIn);
        tokenOut.safeTransfer(params.recipient, params.amountIn);
        return params.amountIn + reportedOutputBonus;
    }

    function _firstToken(bytes calldata path) private pure returns (address token) {
        assembly ("memory-safe") {
            token := shr(96, calldataload(path.offset))
        }
    }

    function _lastToken(bytes calldata path) private pure returns (address token) {
        assembly ("memory-safe") {
            token := shr(96, calldataload(add(path.offset, sub(path.length, 20))))
        }
    }
}
