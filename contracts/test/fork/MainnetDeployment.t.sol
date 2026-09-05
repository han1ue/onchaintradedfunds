// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MainnetRehearsalBase } from "./MainnetRehearsalBase.sol";
import { OTFLaunchManager } from "../../src/OTFLaunchManager.sol";
import {
    IUniswapV4StateView,
    IPermit2AllowanceTransfer
} from "../../src/interfaces/IUniswapV4.sol";

interface RehearsalPositionManager {
    function ownerOf(uint256 id) external view returns (address);
    function getPositionLiquidity(uint256 id) external view returns (uint128);
}

contract MainnetDeploymentTest is MainnetRehearsalBase {
    function testDeploymentAddressesRolesAndOneBillionAllocation() public view {
        assertEq(address(otf), vm.computeCreateAddress(deployer, startingNonce));
        assertEq(address(launchDeployer), vm.computeCreateAddress(deployer, startingNonce + 1));
        assertEq(
            address(launch),
            vm.computeCreate2Address(launchSalt, launchInitCodeHash, address(launchDeployer))
        );
        assertTrue(launch.hookPermissionsValid());
        assertEq(uint160(address(launch)) & 0x3fff, 0x2840);
        assertEq(factory.routerConfigurator(), deployer);
        assertEq(collector.routerConfigurator(), deployer);
        assertEq(factory.entryExitRouter(), address(router));
        assertEq(factory.buybackCollector(), address(collector));
        assertEq(factory.vaultImplementation(), address(implementation));
        assertEq(collector.factory(), address(factory));
        assertEq(router.owner(), administrator);
        assertEq(router.pendingOwner(), address(0));
        assertEq(rewards.owner(), administrator);
        assertEq(vesting.beneficiary(), beneficiary);
        assertEq(vesting.pendingBeneficiary(), address(0));
        assertEq(address(vesting.ethUsdOracle()), address(oracle));
        assertEq(vesting.maxOracleAge(), oracleMaxAge);
        assertTrue(router.isAdapterApproved(address(v3Adapter)));
        assertTrue(router.isAdapterApproved(address(v4Adapter)));
        assertEq(otf.balanceOf(deployer), 0);
        assertEq(otf.balanceOf(address(launch)), 200_000_000 ether);
        assertEq(otf.balanceOf(address(vesting)), 100_000_000 ether);
        assertEq(otf.balanceOf(address(rewards)), 700_000_000 ether);
        assertEq(otf.totalSupply(), 1_000_000_000 ether);
    }

    function testInitializationGraduationLockedPositionAndSupplyReconcile() public {
        uint256 managerOtfBefore = otf.balanceOf(poolManager);
        _graduate();
        assertGt(launch.finalOtfBurned(), 0);
        assertEq(otf.totalSupply() + launch.finalOtfBurned(), 1_000_000_000 ether);
        assertEq(otf.balanceOf(address(launch)), 0);
        assertEq(otf.balanceOf(address(vesting)), 100_000_000 ether);
        assertEq(otf.balanceOf(address(rewards)), 700_000_000 ether);
        assertEq(
            otf.balanceOf(investor) + otf.balanceOf(poolManager) - managerOtfBefore
                + launch.finalOtfBurned(),
            200_000_000 ether
        );
        uint256 id = launch.permanentPositionTokenId();
        assertGt(id, 0);
        assertEq(RehearsalPositionManager(positionManager).ownerOf(id), address(launch));
        assertEq(
            RehearsalPositionManager(positionManager).getPositionLiquidity(id),
            launch.PERMANENT_LIQUIDITY()
        );
        assertEq(
            RehearsalPositionManager(positionManager)
                .getPositionLiquidity(launch.bootstrapPositionTokenId()),
            0
        );
        assertEq(weth.allowance(address(launch), permit2), 0);
        assertEq(otf.allowance(address(launch), permit2), 0);
        (uint160 amount,,) = IPermit2AllowanceTransfer(permit2)
            .allowance(address(launch), address(weth), positionManager);
        assertEq(amount, 0);
        (uint160 sqrtPrice,,,) = IUniswapV4StateView(stateView).getSlot0(launch.poolId());
        assertEq(sqrtPrice, launch.finalSqrtPriceX96());
    }

    function testAdministratorHandoffAndRewardsClaimAfterDeployment() public {
        address successor = makeAddr("rehearsal successor administrator");
        vm.prank(administrator);
        router.transferOwnership(successor);
        assertEq(router.owner(), administrator);
        vm.prank(successor);
        router.acceptOwnership();
        assertEq(router.owner(), successor);
        vm.prank(successor);
        router.setAdapterApproved(address(v3Adapter), false);
        assertFalse(router.isAdapterApproved(address(v3Adapter)));

        uint256 entitlement = 1_000 ether;
        bytes32 root = rewards.leafFor(investor, entitlement);
        vm.prank(administrator);
        rewards.setMerkleRoot(root);
        rewards.claim(investor, entitlement, new bytes32[](0));
        assertEq(otf.balanceOf(investor), entitlement);
        assertEq(rewards.claimed(investor), entitlement);
        assertEq(otf.balanceOf(address(rewards)), 700_000_000 ether - entitlement);
    }
}
