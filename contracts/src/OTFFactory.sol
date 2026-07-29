// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ManagedOTFVault } from "./ManagedOTFVault.sol";
import { MinimalClones } from "./libraries/MinimalClones.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { VaultInitParams } from "./VaultTypes.sol";

contract OTFFactory is IAdapterAllowlist {
    using SafeTransferLib for address;

    uint256 public constant MIN_REBALANCE_COOLDOWN = 7 days;
    uint16 public constant MAX_CREATOR_FEE_BPS_PER_YEAR = 1_000;
    uint16 public constant MAX_PROTOCOL_FEE_SHARE_BPS = 5_000;
    uint16 public constant GLOBAL_MAX_TURNOVER_BPS = 10_000;
    uint16 public constant GLOBAL_MAX_NAV_LOSS_BPS = 1_000;
    uint16 public constant GLOBAL_MAX_WEIGHT_DEVIATION_BPS = 1_000;
    uint8 public constant GLOBAL_MAX_ASSET_COUNT = 20;

    error NotOwner();
    error ZeroAddress();
    error InvalidImplementation();
    error RebalanceCooldownTooShort();
    error CreatorFeeTooHigh(uint16 feeBps, uint16 maximum);
    error ProtocolFeeShareTooHigh(uint16 shareBps, uint16 maximum);
    error LimitTooHigh();
    error InvalidLimit();
    error InvalidArrayLength();

    event VaultCreated(
        address indexed creator,
        address indexed vault,
        uint256 indexed nonce,
        string name,
        string symbol,
        uint32 rebalanceCooldown
    );
    event TradeAdapterApprovalChanged(address indexed adapter, bool approved);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProtocolTreasuryTransferStarted(address indexed currentTreasury, address indexed pendingTreasury);
    event ProtocolTreasuryTransferred(address indexed oldTreasury, address indexed newTreasury);

    address public owner;
    address public pendingOwner;
    address public vaultImplementation;
    address public protocolTreasury;
    address public pendingProtocolTreasury;
    address public feeCollector;
    address public assetRegistry;
    address public oracleRegistry;
    address public rebalanceExecutor;
    uint16 public protocolFeeShareBps;

    address[] private _vaults;
    mapping(address => address) public creatorOf;
    mapping(address => uint256) public creatorNonce;
    mapping(address => bool) public isVault;
    mapping(address => bool) public isTradeAdapterApproved;

    constructor(
        address vaultImplementation_,
        address protocolTreasury_,
        address feeCollector_,
        address assetRegistry_,
        address oracleRegistry_,
        address rebalanceExecutor_,
        uint16 protocolFeeShareBps_
    ) {
        if (vaultImplementation_.code.length == 0) revert InvalidImplementation();
        if (
            protocolTreasury_ == address(0) || feeCollector_ == address(0)
                || assetRegistry_ == address(0) || oracleRegistry_ == address(0)
                || rebalanceExecutor_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (protocolFeeShareBps_ > MAX_PROTOCOL_FEE_SHARE_BPS) {
            revert ProtocolFeeShareTooHigh(protocolFeeShareBps_, MAX_PROTOCOL_FEE_SHARE_BPS);
        }

        owner = msg.sender;
        vaultImplementation = vaultImplementation_;
        protocolTreasury = protocolTreasury_;
        feeCollector = feeCollector_;
        assetRegistry = assetRegistry_;
        oracleRegistry = oracleRegistry_;
        rebalanceExecutor = rebalanceExecutor_;
        protocolFeeShareBps = protocolFeeShareBps_;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function allVaults() external view returns (address[] memory) {
        return _vaults;
    }

    function createVault(VaultInitParams calldata params) external returns (address vault) {
        _validateFactoryBounds(params);

        uint256 nonce = creatorNonce[msg.sender];
        bytes32 salt = _salt(msg.sender, nonce, params);
        creatorNonce[msg.sender] = nonce + 1;

        vault = MinimalClones.cloneDeterministic(vaultImplementation, salt);

        for (uint256 i = 0; i < params.initialAssets.length; i++) {
            params.initialAssets[i].safeTransferFrom(msg.sender, vault, params.initialAmounts[i]);
        }

        isVault[vault] = true;
        creatorOf[vault] = msg.sender;
        _vaults.push(vault);

        ManagedOTFVault(vault).initialize(
            params,
            address(this),
            assetRegistry,
            oracleRegistry,
            rebalanceExecutor,
            feeCollector,
            protocolFeeShareBps
        );

        emit VaultCreated(msg.sender, vault, nonce, params.name, params.symbol, params.rebalanceCooldown);
    }

    function predictVaultAddress(address creator, uint256 nonce, VaultInitParams calldata params)
        external
        view
        returns (address)
    {
        return MinimalClones.predictDeterministicAddress(
            vaultImplementation,
            _salt(creator, nonce, params),
            address(this)
        );
    }

    function setTradeAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0) || adapter.code.length == 0) revert ZeroAddress();
        isTradeAdapterApproved[adapter] = approved;
        emit TradeAdapterApprovalChanged(adapter, approved);
    }

    function beginOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
    }

    function acceptOwnershipTransfer() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function beginProtocolTreasuryTransfer(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        pendingProtocolTreasury = newTreasury;
        emit ProtocolTreasuryTransferStarted(protocolTreasury, newTreasury);
    }

    function acceptProtocolTreasuryTransfer() external {
        if (msg.sender != pendingProtocolTreasury) revert NotOwner();
        address oldTreasury = protocolTreasury;
        protocolTreasury = msg.sender;
        pendingProtocolTreasury = address(0);
        emit ProtocolTreasuryTransferred(oldTreasury, msg.sender);
    }

    function _validateFactoryBounds(VaultInitParams calldata params) internal pure {
        if (params.rebalanceCooldown < MIN_REBALANCE_COOLDOWN) revert RebalanceCooldownTooShort();
        if (params.initialAssets.length != params.initialTargetWeightsBps.length) {
            revert InvalidArrayLength();
        }
        if (params.initialAssets.length != params.initialAmounts.length) revert InvalidArrayLength();
        if (params.creatorFeeBpsPerYear > MAX_CREATOR_FEE_BPS_PER_YEAR) {
            revert CreatorFeeTooHigh(params.creatorFeeBpsPerYear, MAX_CREATOR_FEE_BPS_PER_YEAR);
        }
        if (params.maxAssetCount == 0 || params.maxOracleStaleness == 0) revert InvalidLimit();
        if (params.maxAssetCount > GLOBAL_MAX_ASSET_COUNT) revert LimitTooHigh();
        if (params.initialAssets.length > params.maxAssetCount) revert LimitTooHigh();
        if (params.maxTurnoverBps > GLOBAL_MAX_TURNOVER_BPS) revert LimitTooHigh();
        if (params.maxNavLossBps > GLOBAL_MAX_NAV_LOSS_BPS) revert LimitTooHigh();
        if (params.maxWeightDeviationBps > GLOBAL_MAX_WEIGHT_DEVIATION_BPS) revert LimitTooHigh();
        if (params.maxSingleAssetWeightBps > 10_000) revert LimitTooHigh();
        if (params.minNonZeroAssetWeightBps == 0 || params.minNonZeroAssetWeightBps > 10_000) {
            revert InvalidLimit();
        }
    }

    function _salt(address creator, uint256 nonce, VaultInitParams calldata params)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(creator, nonce, keccak256(abi.encode(params))));
    }
}
