// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "../src/interfaces/IERC20.sol";
import { ManagedOTFVault } from "../src/ManagedOTFVault.sol";
import { OTFFactory } from "../src/OTFFactory.sol";
import { VaultCreationParams } from "../src/VaultTypes.sol";
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
        return vault.routerRedeem(shares, owner, receiver, minimums, 0);
    }
}

contract MockBuybackReceiver {
    mapping(address => uint256) public creatorFeeShares;
    mapping(address => uint256) public buybackFeeShares;

    function recordFeeShares(uint256 creatorShares, uint256 buybackShares) external {
        creatorFeeShares[msg.sender] += creatorShares;
        buybackFeeShares[msg.sender] += buybackShares;
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

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
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

abstract contract BootstrapTestBase is TestBase {
    uint256 internal constant WAD = 1e18;
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function _deployFactory()
        internal
        returns (OTFFactory factory, address collector, MockCoreRouter router)
    {
        ManagedOTFVault implementation = new ManagedOTFVault();
        collector = address(new MockBuybackReceiver());
        MockStockToken protocolOtf = new MockStockToken("Onchain Traded Funds", "OTF", 18);
        factory = new OTFFactory(address(implementation), collector, address(protocolOtf));
        router = new MockCoreRouter(address(factory));
        factory.configureEntryExitRouter(address(router));
    }

    function _creationParams(
        address[] memory assets,
        uint256[] memory bootstrapUnits,
        uint16 expenseRatioBps
    ) internal pure returns (VaultCreationParams memory params) {
        params = VaultCreationParams({
            name: "Bootstrap OTF",
            symbol: "BOTF",
            fundThesis: "A fixed basket of tokenized assets.",
            expenseBeneficiary: BENEFICIARY,
            annualCreatorExpenseRatioBps: expenseRatioBps,
            mintFeeBps: 0,
            redeemFeeBps: 0,
            constituents: assets,
            bootstrapBasketUnitsPerOTF: bootstrapUnits
        });
    }

    function _createVault(
        OTFFactory factory,
        address[] memory assets,
        uint256[] memory bootstrapUnits,
        uint16 expenseRatioBps
    ) internal returns (ManagedOTFVault vault) {
        vm.prank(CREATOR);
        vault = ManagedOTFVault(
            factory.createVault(_creationParams(assets, bootstrapUnits, expenseRatioBps))
        );
    }

    function _createTwoAssetVault(
        OTFFactory factory,
        address first,
        address second,
        uint256 firstUnits,
        uint256 secondUnits,
        uint16 expenseRatioBps
    ) internal returns (ManagedOTFVault vault) {
        address[] memory assets = new address[](2);
        assets[0] = first;
        assets[1] = second;
        uint256[] memory units = new uint256[](2);
        units[0] = firstUnits;
        units[1] = secondUnits;
        vault = _createVault(factory, assets, units, expenseRatioBps);
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
