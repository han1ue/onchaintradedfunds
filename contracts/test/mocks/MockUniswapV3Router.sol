// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IUniswapV3SwapRouter } from "../../src/interfaces/IUniswapV3SwapRouter.sol";
import { SafeTransferLib } from "../../src/libraries/SafeTransferLib.sol";

contract MockUniswapV3Router is IUniswapV3SwapRouter {
    using SafeTransferLib for address;

    address public factory;
    uint256 public reportedOutputBonus;
    uint256 public outputNumerator = 1;
    uint256 public outputDenominator = 1;
    bool public failNextSwap;
    bool public skipInputPull;
    bytes public lastPath;

    function setFactory(address factory_) external {
        factory = factory_;
    }

    function setRate(uint256 numerator, uint256 denominator) external {
        require(numerator != 0 && denominator != 0, "RATE");
        outputNumerator = numerator;
        outputDenominator = denominator;
    }

    function setReportedOutputBonus(uint256 bonus) external {
        reportedOutputBonus = bonus;
    }

    function setFailNextSwap(bool fail) external {
        failNextSwap = fail;
    }

    function setSkipInputPull(bool skip) external {
        skipInputPull = skip;
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        if (failNextSwap) {
            failNextSwap = false;
            revert("LEG_FAILED");
        }
        lastPath = params.path;
        address tokenIn = _firstToken(params.path);
        address tokenOut = _lastToken(params.path);
        amountOut = params.amountIn * outputNumerator / outputDenominator;
        require(amountOut >= params.amountOutMinimum, "SLIPPAGE");
        if (!skipInputPull) tokenIn.safeTransferFrom(msg.sender, address(this), params.amountIn);
        tokenOut.safeTransfer(params.recipient, amountOut);
        return amountOut + reportedOutputBonus;
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
