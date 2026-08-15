// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockStockToken } from "../src/mocks/MockStockToken.sol";
import { MockZeroXAllowanceHolder } from "../src/mocks/MockZeroXAllowanceHolder.sol";
import { MockZeroXTarget } from "../src/mocks/MockZeroXTarget.sol";
import { ZeroXSwapAdapter } from "../src/ZeroXSwapAdapter.sol";
import { SafeTransferLib } from "../src/libraries/SafeTransferLib.sol";
import { TestBase } from "./TestBase.sol";

contract ZeroXSwapAdapterTest is TestBase {
    MockStockToken private tokenIn;
    MockStockToken private tokenOut;
    MockStockToken private settlement;
    MockZeroXTarget private target;
    MockZeroXAllowanceHolder private allowanceHolder;
    ZeroXSwapAdapter private adapter;

    address private constant OTHER = address(0xBEEF);
    address private constant ATTACKER = address(0xBAD);

    function setUp() public {
        tokenIn = new MockStockToken("Token In", "IN", 18);
        tokenOut = new MockStockToken("Token Out", "OUT", 18);
        settlement = new MockStockToken("Settlement", "USDG", 6);
        target = new MockZeroXTarget();
        allowanceHolder = new MockZeroXAllowanceHolder(address(target));
        target.setAllowanceTarget(address(allowanceHolder));
        adapter = new ZeroXSwapAdapter(
            address(this), address(target), address(allowanceHolder), address(settlement)
        );
        adapter.setCallerApproved(address(this), true);

        tokenOut.mint(address(target), 1_000 ether);
        settlement.mint(address(target), 1_000_000e6);
    }

    function testExactInputUsesRawCalldataAndObservedBalanceDeltas() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data =
            _fill(address(tokenIn), address(tokenOut), 10 ether, 25 ether, address(adapter));

        uint256 received =
            adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 24 ether, data);

        assertEq(received, 25 ether);
        assertEq(tokenOut.balanceOf(address(this)), 25 ether);
        assertEq(tokenIn.balanceOf(address(target)), 10 ether);
        assertEq(target.lastAllowance(), 10 ether);
        assertEq(target.lastTaker(), address(adapter));
        assertEq(target.lastRecipient(), address(adapter));
        _assertClean(address(tokenIn), address(tokenOut));
    }

    function testExactOutputRefundsEveryUnusedSettlementToken() public {
        settlement.mint(address(this), 20e6);
        settlement.approve(address(adapter), 20e6);
        bytes memory data =
            _fill(address(settlement), address(tokenOut), 8e6, 5 ether, address(adapter));

        uint256 spent =
            adapter.buyExactOutput(address(settlement), address(tokenOut), 5 ether, 20e6, data);

        assertEq(spent, 8e6);
        assertEq(settlement.balanceOf(address(this)), 12e6);
        assertEq(tokenOut.balanceOf(address(this)), 5 ether);
        assertEq(target.lastAllowance(), 20e6);
        _assertClean(address(settlement), address(tokenOut));
    }

    function testExactInputSlippageRevertsAtomically() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data =
            _fill(address(tokenIn), address(tokenOut), 10 ether, 9 ether, address(adapter));

        vm.expectPartialRevert(ZeroXSwapAdapter.Slippage.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 10 ether, data);

        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
        assertEq(tokenIn.balanceOf(address(target)), 0);
        assertEq(tokenOut.balanceOf(address(this)), 0);
        assertEq(tokenIn.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testExactInputRejectsPartialInputUse() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data =
            _fill(address(tokenIn), address(tokenOut), 9 ether, 20 ether, address(adapter));

        vm.expectPartialRevert(ZeroXSwapAdapter.InputMismatch.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
        assertEq(tokenOut.balanceOf(address(this)), 0);
        assertEq(tokenIn.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testWrongRecipientIsDetectedByAdapterOutputBalance() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data = _fill(address(tokenIn), address(tokenOut), 10 ether, 20 ether, OTHER);

        vm.expectPartialRevert(ZeroXSwapAdapter.Slippage.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenOut.balanceOf(OTHER), 0);
        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
    }

    function testExactOutputRejectsShortAndExcessOutput() public {
        settlement.mint(address(this), 40e6);
        settlement.approve(address(adapter), 40e6);

        bytes memory shortData =
            _fill(address(settlement), address(tokenOut), 8e6, 5 ether - 1, address(adapter));
        vm.expectPartialRevert(ZeroXSwapAdapter.OutputMismatch.selector);
        adapter.buyExactOutput(address(settlement), address(tokenOut), 5 ether, 20e6, shortData);

        bytes memory excessData =
            _fill(address(settlement), address(tokenOut), 8e6, 5 ether + 1, address(adapter));
        vm.expectPartialRevert(ZeroXSwapAdapter.OutputMismatch.selector);
        adapter.buyExactOutput(address(settlement), address(tokenOut), 5 ether, 20e6, excessData);

        assertEq(settlement.balanceOf(address(this)), 40e6);
        assertEq(tokenOut.balanceOf(address(this)), 0);
        _assertClean(address(settlement), address(tokenOut));
    }

    function testExactOutputWrongRecipientRevertsAtomically() public {
        settlement.mint(address(this), 20e6);
        settlement.approve(address(adapter), 20e6);
        bytes memory data = _fill(address(settlement), address(tokenOut), 8e6, 5 ether, OTHER);

        vm.expectPartialRevert(ZeroXSwapAdapter.OutputMismatch.selector);
        adapter.buyExactOutput(address(settlement), address(tokenOut), 5 ether, 20e6, data);

        assertEq(settlement.balanceOf(address(this)), 20e6);
        assertEq(tokenOut.balanceOf(OTHER), 0);
        _assertClean(address(settlement), address(tokenOut));
    }

    function testMaliciousCalldataCannotStealInputWithoutDeliveringOutput() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data = abi.encodeCall(
            MockZeroXTarget.spendWithoutOutput, (address(tokenIn), 10 ether, ATTACKER)
        );

        vm.expectPartialRevert(ZeroXSwapAdapter.Slippage.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenIn.balanceOf(ATTACKER), 0);
        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
    }

    function testQuoteForWrongTakerCannotUseAdapterAllowance() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data = abi.encodeCall(
            MockZeroXTarget.fillFrom,
            (address(tokenIn), address(tokenOut), OTHER, 10 ether, 20 ether, address(adapter))
        );

        vm.expectRevert(SafeTransferLib.SafeTransferFromFailed.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
        assertEq(tokenIn.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testExactOutputQuoteForWrongTakerCannotSubsidizeEntry() public {
        settlement.mint(address(this), 20e6);
        settlement.approve(address(adapter), 20e6);
        settlement.mint(OTHER, 8e6);
        vm.prank(OTHER);
        settlement.approve(address(allowanceHolder), 8e6);
        bytes memory data = abi.encodeCall(
            MockZeroXTarget.fillFrom,
            (address(settlement), address(tokenOut), OTHER, 8e6, 5 ether, address(adapter))
        );

        vm.expectRevert(ZeroXSwapAdapter.NoInputSpent.selector);
        adapter.buyExactOutput(address(settlement), address(tokenOut), 5 ether, 20e6, data);

        assertEq(settlement.balanceOf(address(this)), 20e6);
        assertEq(settlement.balanceOf(OTHER), 8e6);
        assertEq(tokenOut.balanceOf(address(this)), 0);
        _assertClean(address(settlement), address(tokenOut));
    }

    function testZeroXRevertDataIsBubbledExactly() public {
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data = abi.encodeCall(MockZeroXTarget.fail, (77));

        vm.expectRevert(abi.encodeWithSelector(MockZeroXTarget.MockSwapFailed.selector, 77));
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenIn.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testUnauthorizedCallerCannotExecuteEitherTradeMode() public {
        tokenIn.mint(address(adapter), 10 ether);
        vm.startPrank(ATTACKER);
        vm.expectPartialRevert(ZeroXSwapAdapter.UnauthorizedCaller.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, "");
        vm.expectPartialRevert(ZeroXSwapAdapter.UnauthorizedCaller.selector);
        adapter.buyExactOutput(address(settlement), address(tokenOut), 1, 1, "");
        vm.stopPrank();
    }

    function testReentrantTargetCallIsRejected() public {
        adapter.setCallerApproved(address(target), true);
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory nested =
            _fill(address(tokenIn), address(tokenOut), 10 ether, 20 ether, address(adapter));
        bytes memory data = abi.encodeCall(
            MockZeroXTarget.reenter,
            (address(adapter), address(tokenIn), address(tokenOut), 10 ether, nested)
        );

        vm.expectRevert(ZeroXSwapAdapter.Reentrancy.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        assertEq(tokenIn.balanceOf(address(adapter)), 10 ether);
        assertEq(tokenIn.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testResidualBalanceMustBeRecoveredBeforeTrading() public {
        tokenOut.mint(address(adapter), 1);
        tokenIn.mint(address(adapter), 10 ether);
        bytes memory data =
            _fill(address(tokenIn), address(tokenOut), 10 ether, 20 ether, address(adapter));

        vm.expectPartialRevert(ZeroXSwapAdapter.ResidualBalance.selector);
        adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);

        uint256 recovered = adapter.recoverToken(address(tokenOut), address(this));
        assertEq(recovered, 1);
        assertEq(tokenOut.balanceOf(address(adapter)), 0);

        uint256 received =
            adapter.executeSwap(address(tokenIn), address(tokenOut), 10 ether, 1, data);
        assertEq(received, 20 ether);
        _assertClean(address(tokenIn), address(tokenOut));
    }

    function testExactOutputRequiresConfiguredSettlementToken() public {
        vm.expectPartialRevert(ZeroXSwapAdapter.InvalidSettlementToken.selector);
        adapter.buyExactOutput(address(tokenIn), address(tokenOut), 1, 1, "");
    }

    function _fill(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 buyAmount,
        address recipient
    ) private pure returns (bytes memory) {
        return abi.encodeCall(
            MockZeroXTarget.fill, (sellToken, buyToken, sellAmount, buyAmount, recipient)
        );
    }

    function _assertClean(address sellToken, address buyToken) private view {
        assertEq(tokenIn.allowance(address(adapter), address(target)), 0);
        assertEq(settlement.allowance(address(adapter), address(target)), 0);
        assertEq(IERC20Like(sellToken).balanceOf(address(adapter)), 0);
        assertEq(IERC20Like(buyToken).balanceOf(address(adapter)), 0);
        assertEq(IERC20Like(sellToken).allowance(address(adapter), address(allowanceHolder)), 0);
    }
}

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}
