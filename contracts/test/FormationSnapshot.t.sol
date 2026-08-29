// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { ManagedOTFVaultStorage } from "../src/ManagedOTFVaultStorage.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { FormationSnapshot, VaultCreationParams } from "../src/VaultTypes.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { FormationTestBase, MockCoreRouter } from "./FormationTestBase.sol";

contract Mock1271FormationAuthority {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    address public immutable signer;
    bool public enabled = true;

    constructor(address signer_) {
        signer = signer_;
    }

    function setEnabled(bool enabled_) external {
        enabled = enabled_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (!enabled || signature.length != 65) return bytes4(0xffffffff);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        return ecrecover(digest, v, r, s) == signer ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

contract MockMutableDecimalsToken {
    uint8 public decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }
}

contract MockCallerDependentDecimalsToken {
    address private immutable _factory;
    uint8 private immutable _defaultDecimals;
    uint8 private immutable _factoryDecimals;

    constructor(address factory_, uint8 defaultDecimals_, uint8 factoryDecimals_) {
        _factory = factory_;
        _defaultDecimals = defaultDecimals_;
        _factoryDecimals = factoryDecimals_;
    }

    function decimals() external view returns (uint8) {
        return msg.sender == _factory ? _factoryDecimals : _defaultDecimals;
    }
}

contract FormationSnapshotTest is FormationTestBase {
    OTFFactory internal factory;
    MockCoreRouter internal router;
    MockStockToken internal tokenA;
    MockStockToken internal tokenB;

    function setUp() public {
        (factory,, router) = _deployFactory(address(0), 4_000, 0);
        tokenA = new MockStockToken("Asset A", "A", 18);
        tokenB = new MockStockToken("Asset B", "B", 6);
    }

    function testSignedFormationDerivesAndLocksRelativeQuantities() public {
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        uint256[] memory caps = new uint256[](2);
        caps[0] = 3 * WAD;
        caps[1] = WAD;
        uint256[] memory prices = new uint256[](2);
        prices[0] = 2 * WAD;
        prices[1] = WAD / 2;
        FormationSnapshot memory snapshot = _snapshot(factory, assets, caps, prices, 1);

        ManagedOTFVault vault = _createVault(factory, snapshot, 1_000);

        assertEq(vault.totalSupply(), 0);
        assertEq(vault.relativeQuantity(address(tokenA)), 375_000_000_000_000_000);
        assertEq(vault.relativeQuantity(address(tokenB)), 500_000);
        assertEq(vault.annualCreatorExpenseRatioBps(), 1_000);
        assertEq(vault.expenseBeneficiary(), BENEFICIARY);
        assertEq(vault.creator(), CREATOR);
        assertEq(vault.entryExitRouter(), address(router));
        assertEq(vault.formationSnapshotDigest(), factory.formationSnapshotDigest(snapshot));
        assertEq(vault.formationCalculationVersion(), 1);
    }

    function testSignedCreatorBlocksFrontRunWithoutConsumingReplayState() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 2);
        bytes memory signature = _sign(factory, snapshot);
        address predicted = factory.predictVaultAddress(snapshot);
        VaultCreationParams memory params = _params(0);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(OTFFactory.UnauthorizedFormationCreator.selector, ALICE, CREATOR)
        );
        factory.createVault(params, snapshot, signature);

        assertFalse(factory.formationNonceUsed(snapshot.nonce));
        assertEq(factory.vaultCount(), 0);
        assertEq(predicted.code.length, 0);

        vm.prank(CREATOR);
        address vault = factory.createVault(params, snapshot, signature);
        assertEq(vault, predicted);
        assertTrue(factory.formationNonceUsed(snapshot.nonce));
        assertEq(ManagedOTFVault(vault).creator(), CREATOR);
    }

    function testCreatorIsSignedAndChangesDeterministicAddress() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 3);
        bytes memory signature = _sign(factory, snapshot);
        bytes32 creatorDigest = factory.formationSnapshotDigest(snapshot);
        address creatorPrediction = factory.predictVaultAddress(snapshot);

        snapshot.creator = ALICE;
        assertTrue(factory.formationSnapshotDigest(snapshot) != creatorDigest);
        assertTrue(factory.predictVaultAddress(snapshot) != creatorPrediction);

        vm.prank(ALICE);
        vm.expectPartialRevert(OTFFactory.InvalidFormationSignature.selector);
        factory.createVault(_params(0), snapshot, signature);
    }

    function testMutableDecimalsMismatchCannotConsumeSnapshot() public {
        MockMutableDecimalsToken mutableDecimals = new MockMutableDecimalsToken(18);
        FormationSnapshot memory snapshot = _twoAssetSnapshot(
            factory, address(mutableDecimals), address(tokenB), 3 * WAD, WAD, 4
        );
        bytes memory signature = _sign(factory, snapshot);
        address predicted = factory.predictVaultAddress(snapshot);

        mutableDecimals.setDecimals(6);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFFactory.TokenDecimalsMismatch.selector, address(mutableDecimals), 18, 6
            )
        );
        factory.createVault(_params(0), snapshot, signature);

        assertFalse(factory.formationNonceUsed(snapshot.nonce));
        assertEq(predicted.code.length, 0);

        mutableDecimals.setDecimals(18);
        vm.prank(CREATOR);
        assertEq(factory.createVault(_params(0), snapshot, signature), predicted);
    }

    function testCallerDependentDecimalsMismatchReverts() public {
        MockCallerDependentDecimalsToken callerDependent =
            new MockCallerDependentDecimalsToken(address(factory), 18, 6);
        assertEq(uint256(callerDependent.decimals()), 18);
        FormationSnapshot memory snapshot = _twoAssetSnapshot(
            factory, address(callerDependent), address(tokenB), 3 * WAD, WAD, 5
        );
        bytes memory signature = _sign(factory, snapshot);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                OTFFactory.TokenDecimalsMismatch.selector, address(callerDependent), 18, 6
            )
        );
        factory.createVault(_params(0), snapshot, signature);

        assertFalse(factory.formationNonceUsed(snapshot.nonce));
    }

    function testSnapshotReplayAndAuthorityNonceReplayRevert() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 7);
        bytes memory signature = _sign(factory, snapshot);
        VaultCreationParams memory params = _params(0);
        vm.prank(CREATOR);
        factory.createVault(params, snapshot, signature);

        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(OTFFactory.FormationNonceAlreadyUsed.selector, 7));
        factory.createVault(params, snapshot, signature);

        snapshot.marketCapsUsdWad[0] = 4 * WAD;
        signature = _sign(factory, snapshot);
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(OTFFactory.FormationNonceAlreadyUsed.selector, 7));
        factory.createVault(params, snapshot, signature);
    }

    function testImmutableEip1271AuthorityAcceptsAndFailsClosed() public {
        Mock1271FormationAuthority contractAuthority =
            new Mock1271FormationAuthority(vm.addr(AUTHORITY_KEY));
        ManagedOTFVault implementation = new ManagedOTFVault();
        FeeCollector localCollector = new FeeCollector(TREASURY);
        OTFFactory contractFactory = new OTFFactory(
            address(implementation),
            address(localCollector),
            address(contractAuthority),
            address(0),
            0,
            0
        );
        MockCoreRouter localRouter = new MockCoreRouter(address(contractFactory));
        contractFactory.configureEntryExitRouter(address(localRouter));
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(contractFactory, address(tokenA), address(tokenB), WAD, WAD, 40);
        _createVault(contractFactory, snapshot, 0);

        contractAuthority.setEnabled(false);
        snapshot =
            _twoAssetSnapshot(contractFactory, address(tokenA), address(tokenB), WAD, WAD, 41);
        bytes memory signature = _sign(contractFactory, snapshot);
        vm.prank(CREATOR);
        vm.expectPartialRevert(OTFFactory.InvalidFormationSignature.selector);
        contractFactory.createVault(_params(0), snapshot, signature);
    }

    function testSignatureBindsOrderedSetAndRawMarketData() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 8);
        bytes memory signature = _sign(factory, snapshot);

        address swap = snapshot.constituents[0];
        snapshot.constituents[0] = snapshot.constituents[1];
        snapshot.constituents[1] = swap;
        vm.prank(CREATOR);
        vm.expectPartialRevert(OTFFactory.InvalidFormationSignature.selector);
        factory.createVault(_params(0), snapshot, signature);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 9);
        signature = _sign(factory, snapshot);
        snapshot.unitPricesUsdWad[0] += 1;
        vm.prank(CREATOR);
        vm.expectPartialRevert(OTFFactory.InvalidFormationSignature.selector);
        factory.createVault(_params(0), snapshot, signature);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), 3 * WAD, WAD, 10);
        signature = _sign(factory, snapshot);
        address predicted = factory.predictVaultAddress(snapshot);
        snapshot.tokenDecimals[0] -= 1;
        assertTrue(factory.predictVaultAddress(snapshot) != predicted);
        vm.prank(CREATOR);
        vm.expectPartialRevert(OTFFactory.InvalidFormationSignature.selector);
        factory.createVault(_params(0), snapshot, signature);
    }

    function testExplicitChainFactoryVersionAndTimeBindings() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 10);
        snapshot.chainId += 1;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotDomain.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 11);
        snapshot.factory = address(0xBAD);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotDomain.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 12);
        snapshot.creator = address(0);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidFormationCreator.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 13);
        snapshot.calculationVersion = 2;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.UnsupportedCalculationVersion.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 14);
        vm.warp(snapshot.expiry);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotTime.selector);
    }

    function testMalformedSetsAndMarketDataRevert() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenA), WAD, WAD, 20);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.DuplicateConstituent.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 21);
        snapshot.constituents[0] = address(0);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidConstituent.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 22);
        snapshot.marketCapsUsdWad[0] = 0;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidMarketData.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 23);
        snapshot.unitPricesUsdWad = new uint256[](1);
        snapshot.unitPricesUsdWad[0] = WAD;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotArrayLength.selector);

        snapshot = _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 24);
        snapshot.tokenDecimals = new uint8[](1);
        snapshot.tokenDecimals[0] = 18;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotArrayLength.selector);

        MockStockToken tooPrecise = new MockStockToken("Too Precise", "TP", 37);
        snapshot = _twoAssetSnapshot(factory, address(tooPrecise), address(tokenA), WAD, WAD, 25);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.UnsupportedTokenDecimals.selector);

        MockStockToken sixDecimals = new MockStockToken("Six", "SIX", 6);
        snapshot = _twoAssetSnapshot(factory, address(sixDecimals), address(tokenA), 1, WAD, 26);
        snapshot.unitPricesUsdWad[0] = type(uint256).max;
        _expectSignedSnapshotRevert(snapshot, OTFFactory.ZeroRelativeQuantity.selector);
    }

    function testMoreThanTwentyConstituentsReverts() public {
        uint256 length = 21;
        address[] memory assets = new address[](length);
        uint256[] memory caps = new uint256[](length);
        uint256[] memory prices = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            assets[i] = address(tokenA);
            caps[i] = WAD;
            prices[i] = WAD;
        }
        FormationSnapshot memory snapshot = _snapshot(factory, assets, caps, prices, 30);
        _expectSignedSnapshotRevert(snapshot, OTFFactory.InvalidSnapshotArrayLength.selector);
    }

    function testBootstrapRequiresOneWholeShareAndUsesCeilRounding() public {
        FormationSnapshot memory snapshot =
            _twoAssetSnapshot(factory, address(tokenA), address(tokenB), WAD, WAD, 31);
        ManagedOTFVault vault = _createVault(factory, snapshot, 0);

        vm.expectPartialRevert(ManagedOTFVaultStorage.BootstrapSharesTooSmall.selector);
        vault.previewMint(WAD - 1);

        uint256[] memory amounts = vault.previewMint(WAD);
        tokenA.mint(address(router), amounts[0]);
        tokenB.mint(address(router), amounts[1]);
        router.approveAsset(address(tokenA), address(vault), amounts[0]);
        router.approveAsset(address(tokenB), address(vault), amounts[1]);
        router.mint(vault, WAD, ALICE, amounts);

        uint256[] memory fractional = vault.previewMint(1);
        assertEq(fractional[0], 1);
        assertEq(fractional[1], 1);
    }

    function _expectSignedSnapshotRevert(FormationSnapshot memory snapshot, bytes4 selector)
        private
    {
        bytes memory signature = _sign(factory, snapshot);
        vm.prank(CREATOR);
        vm.expectPartialRevert(selector);
        factory.createVault(_params(0), snapshot, signature);
    }

    function _params(uint16 ratio) private pure returns (VaultCreationParams memory) {
        return VaultCreationParams({
            name: "Formation OTF",
            symbol: "FOTF",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: ratio
        });
    }
}
