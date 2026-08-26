// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FeeCollector } from "../src/FeeCollector.sol";
import { RebalanceExecutor } from "../src/RebalanceExecutor.sol";
import { ITradeAdapter } from "../src/interfaces/ITradeAdapter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { MockReentrantToken } from "./mocks/MockReentrantToken.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { TestBase } from "./TestBase.sol";

contract ReentrantTreasury {
    FeeCollector private _collector;
    bytes private _reentryCall;

    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryRevertSelector;

    function configure(FeeCollector collector_, bytes calldata reentryCall_) external {
        _collector = collector_;
        _reentryCall = reentryCall_;
        reentryAttempted = false;
        reentrySucceeded = false;
        reentryRevertSelector = bytes4(0);
    }

    function claim(address token, uint256 amount) external {
        _collector.claim(token, amount);
    }

    function claimAll(address token) external returns (uint256 amount) {
        amount = _collector.claimAll(token);
    }

    function onTokenTransfer() external {
        reentryAttempted = true;
        bytes memory result;
        (reentrySucceeded, result) = address(_collector).call(_reentryCall);
        if (!reentrySucceeded && result.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(result, 32))
            }
            reentryRevertSelector = selector;
        }
    }
}

contract ReentrantExecutorAdapter is ITradeAdapter {
    using SafeTransferLib for address;

    RebalanceExecutor public immutable executor;

    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryRevertSelector;

    constructor(RebalanceExecutor executor_) {
        executor = executor_;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256,
        bytes calldata
    ) external returns (uint256 amountOut) {
        reentryAttempted = true;
        TradeInstruction memory nested = TradeInstruction({
            adapter: address(this),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: 1,
            minAmountOut: 1,
            adapterData: ""
        });
        bytes memory result;
        (reentrySucceeded, result) =
            address(executor).call(abi.encodeCall(RebalanceExecutor.executeTrade, (nested, 1)));
        if (!reentrySucceeded && result.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(result, 32))
            }
            reentryRevertSelector = selector;
        }

        amountOut = amountIn;
        tokenOut.safeTransfer(msg.sender, amountOut);
    }
}

contract PermissiveExecutorFactory {
    function isVault(address) external pure returns (bool) {
        return true;
    }

    function isRebalanceAdapterApproved(address) external pure returns (bool) {
        return true;
    }
}

contract ReentrancyGuardsTest is TestBase {
    uint256 private constant ONE = 1e18;

    function testFeeCollectorClaimAllBlocksReentrantClaim() public {
        ReentrantTreasury treasury = new ReentrantTreasury();
        FeeCollector collector = new FeeCollector(address(treasury));
        MockReentrantToken token = new MockReentrantToken("Callback Token", "CALL", 18);
        token.mint(address(collector), 10 * ONE);

        treasury.configure(collector, abi.encodeCall(FeeCollector.claim, (address(token), ONE)));
        token.configureCallback(
            address(treasury), abi.encodeCall(ReentrantTreasury.onTokenTransfer, ()), true
        );

        uint256 claimed = treasury.claimAll(address(token));

        assertEq(claimed, 10 * ONE);
        assertTrue(token.callbackSucceeded());
        assertTrue(treasury.reentryAttempted());
        assertFalse(treasury.reentrySucceeded());
        assertEq(
            bytes32(treasury.reentryRevertSelector()), bytes32(FeeCollector.Reentrancy.selector)
        );
        assertEq(token.balanceOf(address(collector)), 0);
        assertEq(token.balanceOf(address(treasury)), 10 * ONE);
    }

    function testFeeCollectorClaimBlocksReentrantClaimAll() public {
        ReentrantTreasury treasury = new ReentrantTreasury();
        FeeCollector collector = new FeeCollector(address(treasury));
        MockReentrantToken token = new MockReentrantToken("Callback Token", "CALL", 18);
        token.mint(address(collector), 10 * ONE);

        treasury.configure(collector, abi.encodeCall(FeeCollector.claimAll, (address(token))));
        token.configureCallback(
            address(treasury), abi.encodeCall(ReentrantTreasury.onTokenTransfer, ()), true
        );

        treasury.claim(address(token), 4 * ONE);

        assertTrue(token.callbackSucceeded());
        assertTrue(treasury.reentryAttempted());
        assertFalse(treasury.reentrySucceeded());
        assertEq(
            bytes32(treasury.reentryRevertSelector()), bytes32(FeeCollector.Reentrancy.selector)
        );
        assertEq(token.balanceOf(address(collector)), 6 * ONE);
        assertEq(token.balanceOf(address(treasury)), 4 * ONE);
    }

    function testRebalanceExecutorBlocksAdapterReentry() public {
        RebalanceExecutor executor = new RebalanceExecutor(address(this));
        PermissiveExecutorFactory factory = new PermissiveExecutorFactory();
        executor.setFactory(address(factory));

        MockStockToken tokenIn = new MockStockToken("Input", "IN", 18);
        MockStockToken tokenOut = new MockStockToken("Output", "OUT", 18);
        ReentrantExecutorAdapter adapter = new ReentrantExecutorAdapter(executor);
        tokenIn.mint(address(this), 10 * ONE);
        tokenOut.mint(address(adapter), 10 * ONE);
        tokenIn.approve(address(executor), type(uint256).max);

        TradeInstruction memory trade = TradeInstruction({
            adapter: address(adapter),
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            amountIn: 5 * ONE,
            minAmountOut: 5 * ONE,
            adapterData: ""
        });

        uint256 amountOut = executor.executeTrade(trade, 5 * ONE);

        assertEq(amountOut, 5 * ONE);
        assertTrue(adapter.reentryAttempted());
        assertFalse(adapter.reentrySucceeded());
        assertEq(
            bytes32(adapter.reentryRevertSelector()), bytes32(RebalanceExecutor.Reentrancy.selector)
        );
        assertEq(tokenIn.balanceOf(address(adapter)), 5 * ONE);
        assertEq(tokenOut.balanceOf(address(this)), 5 * ONE);
        assertEq(tokenIn.balanceOf(address(executor)), 0);
        assertEq(tokenOut.balanceOf(address(executor)), 0);
    }
}
