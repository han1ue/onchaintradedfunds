// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../src/interfaces/IERC20.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { FormationSnapshot } from "../src/VaultTypes.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { FormationTestBase, MockCoreRouter } from "./FormationTestBase.sol";
import { InvariantTestBase } from "./TestBase.sol";

interface VmWarp {
    function warp(uint256 timestamp) external;
}

contract VaultInvariantHandler {
    VmWarp private constant VM = VmWarp(address(uint160(uint256(keccak256("hevm cheat code")))));

    ManagedOTFVault public immutable vault;
    MockCoreRouter public immutable router;
    MockStockToken public immutable tokenA;
    MockStockToken public immutable tokenB;

    constructor(
        ManagedOTFVault vault_,
        MockCoreRouter router_,
        MockStockToken tokenA_,
        MockStockToken tokenB_
    ) {
        vault = vault_;
        router = router_;
        tokenA = tokenA_;
        tokenB = tokenB_;
    }

    function mint(uint256 seed) external {
        uint256 minimum = vault.totalSupply() == 0 ? 1e18 : 1;
        uint256 shares = minimum + seed % (100e18 - minimum + 1);
        uint256[] memory amounts = vault.previewMint(shares);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, shares, address(this), amounts);
    }

    function redeem(uint256 seed) external {
        uint256 balance = vault.balanceOf(address(this));
        if (balance == 0) return;
        uint256 shares = 1 + seed % balance;
        vault.approve(address(router), 0);
        vault.approve(address(router), shares);
        router.redeem(vault, shares, address(this), address(this), new uint256[](2));
    }

    function transferShares(uint256 seed) external {
        uint256 balance = vault.balanceOf(address(this));
        if (balance == 0) return;
        vault.transfer(address(0xB0B), seed % (balance + 1));
    }

    function advanceAndCheckpoint(uint256 seed) external {
        VM.warp(block.timestamp + seed % 30 days);
        vault.checkpointFees();
    }
}

contract ProtocolInvariantTest is FormationTestBase, InvariantTestBase {
    ManagedOTFVault internal vault;
    FeeCollector internal collector;
    MockCoreRouter internal router;
    MockStockToken internal tokenA;
    MockStockToken internal tokenB;
    VaultInvariantHandler internal handler;

    function setUp() public {
        OTFFactory factory;
        (factory, collector, router) = _deployFactory(address(0), 4_000, 0);
        tokenA = new MockStockToken("Asset A", "A", 18);
        tokenB = new MockStockToken("Asset B", "B", 18);
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 1);
        vault = _createVault(factory, snapshot, 1_000);
        handler = new VaultInvariantHandler(vault, router, tokenA, tokenB);

        uint256[] memory amounts = vault.previewMint(WAD);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, WAD, address(handler), amounts);
        targetContract(address(handler));
    }

    function invariantAccountedBasketEqualsActualAndKeepsFormationRatio() public view {
        uint256 accountedA = vault.accountedBalance(address(tokenA));
        uint256 accountedB = vault.accountedBalance(address(tokenB));
        assertEq(tokenA.balanceOf(address(vault)), accountedA);
        assertEq(tokenB.balanceOf(address(vault)), accountedB);
        assertEq(accountedA, accountedB);
    }

    function invariantAllShareSupplyIsAccountedFor() public view {
        uint256 balances = vault.balanceOf(address(handler)) + vault.balanceOf(BENEFICIARY)
            + vault.balanceOf(address(collector)) + vault.balanceOf(address(0xB0B));
        assertEq(vault.totalSupply(), balances);
    }

    function invariantFullRedemptionPreviewMatchesAccountedAfterCheckpoint() public {
        vault.checkpointFees();
        uint256 supply = vault.totalSupply();
        if (supply == 0) return;
        uint256[] memory outputs = vault.previewRedeem(supply);
        assertEq(outputs[0], vault.accountedBalance(address(tokenA)));
        assertEq(outputs[1], vault.accountedBalance(address(tokenB)));
    }
}

contract VaultFuzzTest is FormationTestBase {
    function testFuzzMintRedeemPreservesBasket(uint256 mintSeed, uint256 redeemSeed) public {
        (OTFFactory factory,, MockCoreRouter router) = _deployFactory(address(0), 0, 0);
        MockStockToken tokenA = new MockStockToken("Asset A", "A", 18);
        MockStockToken tokenB = new MockStockToken("Asset B", "B", 18);
        ManagedOTFVault vault = _createVault(
            factory, _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 1), 0
        );
        uint256 shares = bound(mintSeed, WAD, 1_000_000 * WAD);
        uint256[] memory amounts = vault.previewMint(shares);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, shares, ALICE, amounts);

        uint256 redeemShares = bound(redeemSeed, 1, shares);
        vm.prank(ALICE);
        vault.approve(address(router), redeemShares);
        router.redeem(vault, redeemShares, ALICE, ALICE, new uint256[](2));

        assertEq(tokenA.balanceOf(address(vault)), vault.accountedBalance(address(tokenA)));
        assertEq(tokenB.balanceOf(address(vault)), vault.accountedBalance(address(tokenB)));
        assertEq(vault.accountedBalance(address(tokenA)), vault.accountedBalance(address(tokenB)));
    }
}
