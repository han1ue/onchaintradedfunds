// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SwapLeg } from "../src/OTFEntryExitRouter.sol";
import { AtomicRouterTestBase } from "./mocks/AtomicRouterTestBase.sol";

contract UniswapV3ProtocolIntegrationTest is AtomicRouterTestBase {
    function setUp() public {
        _setUpAtomicRouter();
    }

    function testAuthenticatedThreeHopAndOneHopLegsSettleOneBasket() public {
        _createPool(address(input), address(assetA));
        _createPool(address(assetA), address(assetB));
        _createPool(address(assetB), address(assetC));
        bytes memory threeHop = abi.encodePacked(
            address(input),
            bytes3(FEE),
            address(assetA),
            bytes3(FEE),
            address(assetB),
            bytes3(FEE),
            address(assetC)
        );
        SwapLeg[] memory legs = new SwapLeg[](2);
        legs[0] = SwapLeg({
            adapter: address(v3Adapter),
            tokenIn: address(input),
            tokenOut: address(assetC),
            amountIn: ONE,
            minAmountOut: ONE,
            data: threeHop
        });
        legs[1] = _v3Leg(address(input), address(assetD), ONE, ONE);

        vm.prank(ALICE);
        (uint256 shares,,) = router.mintFromToken(_mintRequest(2 * ONE, ONE), legs);

        assertEq(shares, ONE);
        assertEq(targetVault.balanceOf(ALICE), ONE);
        assertEq(input.allowance(address(v3Adapter), address(venue)), 0);
        _assertRouterClean();
    }
}
