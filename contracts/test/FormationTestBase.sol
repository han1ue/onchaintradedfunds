// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20, IERC20Metadata } from "../src/interfaces/IERC20.sol";
import { FeeCollector } from "../src/FeeCollector.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { OTFToken } from "../src/OTFToken.sol";
import { FormationSnapshot, VaultCreationParams } from "../src/VaultTypes.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { MockStockToken } from "./mocks/MockStockToken.sol";
import { TestBase } from "./TestBase.sol";

contract MockCoreRouter {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }

    function approveAsset(address asset, address spender, uint256 amount) external {
        IERC20(asset).approve(spender, 0);
        IERC20(asset).approve(spender, amount);
    }

    function mint(
        ManagedOTFVault vault,
        uint256 shares,
        address receiver,
        uint256[] calldata maximums
    ) external returns (uint256[] memory) {
        return vault.routerMint(shares, receiver, maximums);
    }

    function redeem(
        ManagedOTFVault vault,
        uint256 shares,
        address owner,
        address receiver,
        uint256[] calldata minimums
    ) external returns (uint256[] memory) {
        return vault.routerRedeem(shares, owner, receiver, minimums);
    }
}

contract SlashableToken is ERC20 {
    error BalanceReadsDisabled();

    bool public balanceReadsDisabled;
    uint8 private _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function slash(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setBalanceReadsDisabled(bool disabled) external {
        balanceReadsDisabled = disabled;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (balanceReadsDisabled) revert BalanceReadsDisabled();
        return super.balanceOf(account);
    }
}

contract CrossMutatingToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    uint8 private _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureCallback(address target, bytes calldata data, bool enabled) external {
        callbackTarget = target;
        callbackData = data;
        callbackEnabled = enabled;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, to, amount);
        _callback();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        override
        returns (bool)
    {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        _callback();
        return true;
    }

    function _callback() private {
        if (!callbackEnabled) return;
        // Best-effort by design: the vault must reject any unexpected net basket mutation.
        (bool callbackSucceeded,) = callbackTarget.call(callbackData);
        callbackSucceeded;
    }
}

abstract contract FormationTestBase is TestBase {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant AUTHORITY_KEY = 0xA11CE;
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant TREASURY = address(0x7000);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    address internal authority;

    function _deployFactory(address protocolToken, uint16 protocolShareBps, uint16 thresholdBps)
        internal
        returns (OTFFactory factory, FeeCollector collector, MockCoreRouter router)
    {
        authority = vm.addr(AUTHORITY_KEY);
        ManagedOTFVault implementation = new ManagedOTFVault();
        collector = new FeeCollector(TREASURY);
        factory = new OTFFactory(
            address(implementation),
            address(collector),
            authority,
            protocolToken,
            protocolShareBps,
            thresholdBps
        );
        router = new MockCoreRouter(address(factory));
        factory.configureEntryExitRouter(address(router));
    }

    function _snapshot(
        OTFFactory factory,
        address[] memory assets,
        uint256[] memory marketCaps,
        uint256[] memory prices,
        uint256 nonce
    ) internal view returns (FormationSnapshot memory snapshot) {
        uint8[] memory tokenDecimals = new uint8[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            tokenDecimals[i] = IERC20Metadata(assets[i]).decimals();
        }
        snapshot = FormationSnapshot({
            chainId: block.chainid,
            factory: address(factory),
            creator: CREATOR,
            constituents: assets,
            tokenDecimals: tokenDecimals,
            marketCapsUsdWad: marketCaps,
            unitPricesUsdWad: prices,
            snapshotTime: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 1 days),
            calculationVersion: 1,
            nonce: nonce
        });
    }

    function _sign(OTFFactory factory, FormationSnapshot memory snapshot)
        internal
        returns (bytes memory signature)
    {
        bytes32 digest = factory.formationSnapshotDigest(snapshot);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTHORITY_KEY, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _createVault(
        OTFFactory factory,
        FormationSnapshot memory snapshot,
        uint16 expenseRatioBps
    ) internal returns (ManagedOTFVault vault) {
        VaultCreationParams memory params = VaultCreationParams({
            name: "Formation OTF",
            symbol: "FOTF",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: expenseRatioBps
        });
        bytes memory signature = _sign(factory, snapshot);
        vm.prank(CREATOR);
        vault = ManagedOTFVault(factory.createVault(params, snapshot, signature));
    }

    function _twoAssetSnapshot(
        OTFFactory factory,
        address first,
        address second,
        uint256 firstCap,
        uint256 secondCap,
        uint256 nonce
    ) internal view returns (FormationSnapshot memory snapshot) {
        address[] memory assets = new address[](2);
        assets[0] = first;
        assets[1] = second;
        uint256[] memory caps = new uint256[](2);
        caps[0] = firstCap;
        caps[1] = secondCap;
        uint256[] memory prices = new uint256[](2);
        prices[0] = WAD;
        prices[1] = WAD;
        snapshot = _snapshot(factory, assets, caps, prices, nonce);
    }

    function _bootstrap(
        ManagedOTFVault vault,
        MockCoreRouter router,
        address[] memory assets,
        uint256 shares
    ) internal returns (uint256[] memory amounts) {
        amounts = vault.previewMint(shares);
        for (uint256 i = 0; i < assets.length; i++) {
            MockStockToken(assets[i]).mint(address(router), amounts[i]);
            router.approveAsset(assets[i], address(vault), amounts[i]);
        }
        router.mint(vault, shares, ALICE, amounts);
    }

    function _zeroes(uint256 length) internal pure returns (uint256[] memory values) {
        values = new uint256[](length);
    }
}
