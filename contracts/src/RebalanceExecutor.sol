// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ITradeAdapter } from "./interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { TradeInstruction } from "./VaultTypes.sol";

contract RebalanceExecutor {
    using SafeTransferLib for address;

    error FactoryAlreadySet();
    error FactoryNotSet();
    error NotOwner();
    error ZeroAddress();
    error InvalidFactory(address factory);
    error UnauthorizedVault();
    error UnapprovedAdapter(address adapter);
    error BadTradeAmount();
    error BadTradeTokens();
    error Slippage(uint256 received, uint256 minimum);
    error TokenTransferMismatch(
        address token, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );

    event FactorySet(address indexed factory);
    event TradeExecuted(
        address indexed vault,
        address indexed adapter,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    address public immutable owner;
    address public factory;

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert FactoryNotSet();
        if (factory_.code.length == 0) revert InvalidFactory(factory_);
        factory = factory_;
        emit FactorySet(factory_);
    }

    function executeTrade(TradeInstruction calldata instruction)
        external
        returns (uint256 amountOut)
    {
        address factory_ = factory;
        if (factory_ == address(0)) revert FactoryNotSet();
        if (!IAdapterAllowlist(factory_).isVault(msg.sender)) revert UnauthorizedVault();
        if (!IAdapterAllowlist(factory_).isTradeAdapterApproved(instruction.adapter)) {
            revert UnapprovedAdapter(instruction.adapter);
        }
        if (instruction.amountIn == 0) revert BadTradeAmount();
        if (instruction.tokenIn == instruction.tokenOut) revert BadTradeTokens();

        _pullExact(instruction.tokenIn, msg.sender, instruction.adapter, instruction.amountIn);

        uint256 balanceBefore = IERC20(instruction.tokenOut).balanceOf(address(this));
        ITradeAdapter(instruction.adapter)
            .executeSwap(
                instruction.tokenIn,
                instruction.tokenOut,
                instruction.amountIn,
                instruction.minAmountOut,
                instruction.adapterData
            );

        uint256 balanceAfter = IERC20(instruction.tokenOut).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;
        amountOut = received;
        if (amountOut == 0 || amountOut < instruction.minAmountOut) {
            revert Slippage(amountOut, instruction.minAmountOut);
        }

        _pushExact(instruction.tokenOut, msg.sender, amountOut);
        emit TradeExecuted(
            msg.sender,
            instruction.adapter,
            instruction.tokenIn,
            instruction.tokenOut,
            instruction.amountIn,
            amountOut
        );
    }

    function _pullExact(address token, address from, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(from);
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(from),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
    }

    function _pushExact(address token, address to, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 receiverBefore = IERC20(token).balanceOf(to);
        token.safeTransfer(to, amount);
        _verifyTransfer(
            token,
            amount,
            senderBefore,
            IERC20(token).balanceOf(address(this)),
            receiverBefore,
            IERC20(token).balanceOf(to)
        );
    }

    function _verifyTransfer(
        address token,
        uint256 expected,
        uint256 senderBefore,
        uint256 senderAfter,
        uint256 receiverBefore,
        uint256 receiverAfter
    ) private pure {
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != expected || receiverDelta != expected) {
            revert TokenTransferMismatch(token, expected, senderDelta, receiverDelta);
        }
    }
}
