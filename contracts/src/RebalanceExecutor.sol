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
    error UnauthorizedVault();
    error UnapprovedAdapter(address adapter);
    error BadTradeAmount();
    error BadTradeTokens();
    error Slippage(uint256 received, uint256 minimum);

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
        owner = initialOwner;
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert FactoryNotSet();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function executeTrade(TradeInstruction calldata instruction) external returns (uint256 amountOut) {
        address factory_ = factory;
        if (factory_ == address(0)) revert FactoryNotSet();
        if (!IAdapterAllowlist(factory_).isVault(msg.sender)) revert UnauthorizedVault();
        if (!IAdapterAllowlist(factory_).isTradeAdapterApproved(instruction.adapter)) {
            revert UnapprovedAdapter(instruction.adapter);
        }
        if (instruction.amountIn == 0) revert BadTradeAmount();
        if (instruction.tokenIn == instruction.tokenOut) revert BadTradeTokens();

        uint256 balanceBefore = IERC20(instruction.tokenOut).balanceOf(address(this));
        instruction.tokenIn.safeTransferFrom(msg.sender, instruction.adapter, instruction.amountIn);

        ITradeAdapter(instruction.adapter).executeSwap(
            instruction.tokenIn,
            instruction.tokenOut,
            instruction.amountIn,
            instruction.minAmountOut,
            instruction.adapterData
        );

        uint256 balanceAfter = IERC20(instruction.tokenOut).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;
        amountOut = received;
        if (amountOut < instruction.minAmountOut) {
            revert Slippage(amountOut, instruction.minAmountOut);
        }

        instruction.tokenOut.safeTransfer(msg.sender, amountOut);
        emit TradeExecuted(
            msg.sender,
            instruction.adapter,
            instruction.tokenIn,
            instruction.tokenOut,
            instruction.amountIn,
            amountOut
        );
    }
}
