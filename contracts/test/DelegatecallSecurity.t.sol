// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { ManagedOTFVaultStrategy } from "../src/ManagedOTFVaultStrategy.sol";
import { TradeInstruction } from "../src/VaultTypes.sol";
import { ProtocolTestBase } from "./ProtocolTestBase.sol";

contract DelegatecallSecurityTest is ProtocolTestBase {
    function testStrategyModuleIdentityAndCodehashAreImmutablePerImplementation() public {
        ManagedOTFVault first = _createVault();
        ManagedOTFVault second = _createVault();

        address module = first.strategyModule();
        assertTrue(module.code.length != 0);
        assertEq(second.strategyModule(), module);
        assertEq(first.strategyModuleCodehash(), module.codehash);
        assertEq(second.strategyModuleCodehash(), module.codehash);
    }

    function testStrategyModuleRejectsDirectAdministrativeCalls() public {
        ManagedOTFVault vault = _createVault();
        ManagedOTFVaultStrategy module = ManagedOTFVaultStrategy(vault.strategyModule());

        vm.expectRevert(ManagedOTFVaultStorage.DirectStrategyCall.selector);
        module.setExecutor(ALICE, true);

        vm.expectRevert(ManagedOTFVaultStorage.DirectStrategyCall.selector);
        module.setManagerFeeBps(100);
    }

    function testStrategyModuleRejectsDirectTradeCalls() public {
        ManagedOTFVault vault = _createVault();
        ManagedOTFVaultStrategy module = ManagedOTFVaultStrategy(vault.strategyModule());
        TradeInstruction[] memory trades = new TradeInstruction[](0);

        vm.expectRevert(ManagedOTFVaultStorage.DirectStrategyCall.selector);
        module.executeRebalanceTrades(trades);
    }

    function testFeeAccrualModuleCallbackRejectsExternalCallers() public {
        ManagedOTFVault vault = _createVault();

        vm.prank(ATTACKER);
        vm.expectRevert(ManagedOTFVaultStorage.UnauthorizedModuleCallback.selector);
        vault.moduleAccrueFees();
    }
}
