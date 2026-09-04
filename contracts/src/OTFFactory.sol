// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ManagedOTFVault } from "./ManagedOTFVault.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { VaultCreationParams } from "./VaultTypes.sol";

interface ICanonicalEntryExitRouter {
    function factory() external view returns (address);
}

/// @notice Permissionless OTF creation from creator-supplied immutable bootstrap basket units.
contract OTFFactory {
    uint256 public constant MIN_CONSTITUENTS = ProtocolConstants.MIN_CONSTITUENTS;
    uint256 public constant MAX_CONSTITUENTS = ProtocolConstants.MAX_CONSTITUENTS;
    uint16 public constant MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS =
        ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS;
    uint16 public constant MAX_MINT_FEE_BPS = ProtocolConstants.MAX_MINT_FEE_BPS;
    uint16 public constant MAX_REDEEM_FEE_BPS = ProtocolConstants.MAX_REDEEM_FEE_BPS;

    error InvalidImplementation();
    error InvalidDependency(address dependency);
    error RouterAlreadyConfigured();
    error RouterNotConfigured();
    error UnauthorizedRouterConfigurator(address caller);
    error RouterFactoryMismatch(address expected, address actual);
    error Reentrancy();

    event EntryExitRouterConfigured(address indexed router);
    event VaultCreated(address indexed creator, address indexed vault, string name, string symbol);

    address public immutable vaultImplementation;
    address public immutable buybackCollector;
    address public immutable otfToken;
    address public immutable routerConfigurator;

    address public entryExitRouter;
    address[] private _vaults;
    mapping(address => bool) public isVault;
    bool private _creating;

    constructor(address vaultImplementation_, address buybackCollector_, address otfToken_) {
        if (vaultImplementation_.code.length == 0) revert InvalidImplementation();
        if (buybackCollector_.code.length == 0) revert InvalidDependency(buybackCollector_);
        if (otfToken_.code.length == 0) revert InvalidDependency(otfToken_);

        vaultImplementation = vaultImplementation_;
        buybackCollector = buybackCollector_;
        otfToken = otfToken_;
        routerConfigurator = msg.sender;
    }

    modifier nonReentrantCreation() {
        if (_creating) revert Reentrancy();
        _creating = true;
        _;
        _creating = false;
    }

    /// @notice Breaks the factory/router constructor cycle. This can succeed exactly once.
    function configureEntryExitRouter(address router) external {
        if (msg.sender != routerConfigurator) revert UnauthorizedRouterConfigurator(msg.sender);
        if (entryExitRouter != address(0)) revert RouterAlreadyConfigured();
        if (router.code.length == 0) revert InvalidDependency(router);
        address observedFactory;
        try ICanonicalEntryExitRouter(router).factory() returns (address factory_) {
            observedFactory = factory_;
        } catch {
            revert InvalidDependency(router);
        }
        if (observedFactory != address(this)) {
            revert RouterFactoryMismatch(address(this), observedFactory);
        }
        entryExitRouter = router;
        emit EntryExitRouterConfigured(router);
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function createVault(VaultCreationParams calldata params)
        external
        nonReentrantCreation
        returns (address vault)
    {
        address router = entryExitRouter;
        if (router == address(0)) revert RouterNotConfigured();
        vault = Clones.clone(vaultImplementation);
        ManagedOTFVault(vault).initialize(params, msg.sender);

        isVault[vault] = true;
        _vaults.push(vault);
        emit VaultCreated(msg.sender, vault, params.name, params.symbol);
    }

    function otfTokenURI() external pure returns (string memory) {
        return "data:application/json,{\"name\":\"Onchain Traded Fund\",\"symbol\":\"OTF\"}";
    }
}
