// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DirectSwapRequest, V3Swap } from "../src/OTFEntryExitRouter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";

contract UniswapV3ProtocolIntegrationTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testDirectLiquiditySupportsBuySellAndOTFToOTF() public {
        V3Swap[] memory leg = new V3Swap[](1);
        leg[0] = _leg(address(input), address(sourceVault), 25 * ONE, 25 * ONE);
        uint256 sourceBefore = sourceVault.balanceOf(ALICE);

        vm.startPrank(ALICE);
        input.approve(address(router), 25 * ONE);
        assertEq(
            router.swapDirect(
                _request(address(input), address(sourceVault), 25 * ONE, 25 * ONE), leg
            ),
            25 * ONE
        );
        assertEq(sourceVault.balanceOf(ALICE), sourceBefore + 25 * ONE);

        sourceVault.approve(address(router), 25 * ONE);
        leg[0] = _leg(address(sourceVault), address(input), 25 * ONE, 25 * ONE);
        assertEq(
            router.swapDirect(
                _request(address(sourceVault), address(input), 25 * ONE, 25 * ONE), leg
            ),
            25 * ONE
        );

        sourceVault.approve(address(router), 10 * ONE);
        leg[0] = _leg(address(sourceVault), address(targetVault), 10 * ONE, 10 * ONE);
        assertEq(
            router.swapDirect(
                _request(address(sourceVault), address(targetVault), 10 * ONE, 10 * ONE), leg
            ),
            10 * ONE
        );
        vm.stopPrank();

        assertEq(targetVault.balanceOf(ALICE), 10 * ONE);
        _assertRouterClean();
    }

    function testAuthenticatedMultihopAndSplitRoutesArePermissionless() public {
        _createPool(address(assetA), address(sourceVault));
        V3Swap[] memory legs = new V3Swap[](2);
        legs[0] = V3Swap({
            amountIn: 6 * ONE,
            minAmountOut: 6 * ONE,
            path: abi.encodePacked(
                address(input), bytes3(FEE), address(assetA), bytes3(FEE), address(sourceVault)
            )
        });
        legs[1] = _leg(address(input), address(sourceVault), 4 * ONE, 4 * ONE);

        vm.startPrank(ALICE);
        input.approve(address(router), 12 * ONE);
        uint256 beforeInput = input.balanceOf(ALICE);
        assertEq(
            router.swapDirect(
                _request(address(input), address(sourceVault), 12 * ONE, 10 * ONE), legs
            ),
            10 * ONE
        );
        vm.stopPrank();

        assertEq(beforeInput - input.balanceOf(ALICE), 10 * ONE);
        assertEq(input.allowance(address(router), address(venue)), 0);
        _assertRouterClean();
    }

    function _request(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        private
        view
        returns (DirectSwapRequest memory request)
    {
        request = DirectSwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minOut,
            deadline: block.timestamp + 1
        });
    }
}
