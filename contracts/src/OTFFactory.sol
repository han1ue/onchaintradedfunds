// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ManagedOTFVault } from "./ManagedOTFVault.sol";
import { MinimalClones } from "./libraries/MinimalClones.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { VaultInitParams } from "./VaultTypes.sol";

interface IFeeCollectorTreasury {
    function treasury() external view returns (address);
    function pendingTreasury() external view returns (address);
}

interface IOfficialMarketRegistry {
    function createOfficialPool(address vault) external returns (address pool);
}

contract OTFFactory is IAdapterAllowlist {
    using SafeTransferLib for address;

    uint256 public constant STRATEGY_CHANGE_COOLDOWN = 14 days;
    uint16 public constant MAX_CREATOR_FEE_BPS_PER_YEAR = 1_000;
    uint16 public constant MAX_PROTOCOL_FEE_SHARE_BPS = 5_000;
    uint16 public constant GLOBAL_MAX_TURNOVER_BPS = 10_000;
    uint16 public constant GLOBAL_MAX_NAV_LOSS_BPS = 200;
    uint16 public constant GLOBAL_MAX_WEIGHT_DEVIATION_BPS = 1_000;
    uint16 public constant GLOBAL_MAX_CHALLENGE_WEIGHT_DEVIATION_BPS = 2_500;
    uint32 public constant MIN_CHALLENGE_GRACE_PERIOD = 5 days;
    uint32 public constant MAX_CHALLENGE_GRACE_PERIOD = 30 days;
    uint32 public constant MAX_ORACLE_STALENESS = 1 hours;
    uint256 public constant MINIMUM_LIQUIDITY_SHARES = 1_000_000;
    uint256 public constant MAX_STRATEGY_RATIONALE_BYTES = 2_048;

    error NotOwner();
    error ZeroAddress();
    error InvalidImplementation();
    error InvalidDependency(address dependency);
    error InitialShareSupplyTooSmall(uint256 supplied, uint256 minimum);
    error CreatorFeeTooHigh(uint16 feeBps, uint16 maximum);
    error ProtocolFeeShareTooHigh(uint16 shareBps, uint16 maximum);
    error LimitTooHigh();
    error InvalidLimit();
    error InvalidArrayLength();
    error StrategyRationaleRequired();
    error StrategyRationaleTooLong(uint256 length);
    error Reentrancy();
    error AssetTransferMismatch(
        address asset, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error OfficialMarketRegistryNotConfigured();
    error OfficialMarketRegistryLocked();

    event VaultCreated(
        address indexed creator,
        address indexed vault,
        uint256 indexed nonce,
        string name,
        string symbol
    );
    event TradeAdapterApprovalChanged(address indexed adapter, bool approved);
    event MinimumTargetWeightUpdated(uint16 previousMinimumBps, uint16 newMinimumBps);
    event OfficialMarketRegistryConfigured(address indexed registry);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    address public owner;
    address public pendingOwner;
    address public vaultImplementation;
    address public feeCollector;
    address public assetRegistry;
    address public oracleRegistry;
    address public rebalanceExecutor;
    uint16 public protocolFeeShareBps;
    uint16 public minTargetWeightBps = 100;
    address public officialMarketRegistry;

    address[] private _vaults;
    mapping(address => address) public creatorOf;
    mapping(address => uint256) public creatorNonce;
    mapping(address => bool) public isVault;
    mapping(address => bool) public isTradeAdapterApproved;
    bool private _creating;

    constructor(
        address vaultImplementation_,
        address feeCollector_,
        address assetRegistry_,
        address oracleRegistry_,
        address rebalanceExecutor_,
        uint16 protocolFeeShareBps_
    ) {
        if (vaultImplementation_.code.length == 0) {
            revert InvalidImplementation();
        }
        if (
            feeCollector_ == address(0) || assetRegistry_ == address(0)
                || oracleRegistry_ == address(0) || rebalanceExecutor_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (feeCollector_.code.length == 0) revert InvalidDependency(feeCollector_);
        if (assetRegistry_.code.length == 0) revert InvalidDependency(assetRegistry_);
        if (oracleRegistry_.code.length == 0) revert InvalidDependency(oracleRegistry_);
        if (rebalanceExecutor_.code.length == 0) revert InvalidDependency(rebalanceExecutor_);
        if (protocolFeeShareBps_ > MAX_PROTOCOL_FEE_SHARE_BPS) {
            revert ProtocolFeeShareTooHigh(protocolFeeShareBps_, MAX_PROTOCOL_FEE_SHARE_BPS);
        }

        owner = msg.sender;
        vaultImplementation = vaultImplementation_;
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

    modifier nonReentrantCreation() {
        if (_creating) revert Reentrancy();
        _creating = true;
        _;
        _creating = false;
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

    function protocolTreasury() external view returns (address) {
        return IFeeCollectorTreasury(feeCollector).treasury();
    }

    function pendingProtocolTreasury() external view returns (address) {
        return IFeeCollectorTreasury(feeCollector).pendingTreasury();
    }

    function createVault(VaultInitParams calldata params)
        external
        nonReentrantCreation
        returns (address vault)
    {
        address marketRegistry = officialMarketRegistry;
        if (marketRegistry == address(0)) revert OfficialMarketRegistryNotConfigured();
        _validateFactoryBounds(params);

        uint256 nonce = creatorNonce[msg.sender];
        bytes32 salt = _salt(msg.sender, nonce, params);
        creatorNonce[msg.sender] = nonce + 1;

        vault = MinimalClones.cloneDeterministic(vaultImplementation, salt);
        ManagedOTFVault(vault).bindFactory(salt);

        for (uint256 i = 0; i < params.initialAssets.length; i++) {
            _transferInitialAssetExact(
                params.initialAssets[i], msg.sender, vault, params.initialAmounts[i]
            );
        }

        isVault[vault] = true;
        creatorOf[vault] = msg.sender;
        _vaults.push(vault);

        ManagedOTFVault(vault)
            .initialize(
                params,
                address(this),
                assetRegistry,
                oracleRegistry,
                rebalanceExecutor,
                feeCollector,
                protocolFeeShareBps
            );

        IOfficialMarketRegistry(marketRegistry).createOfficialPool(vault);

        emit VaultCreated(msg.sender, vault, nonce, params.name, params.symbol);
    }

    function predictVaultAddress(address creator, uint256 nonce, VaultInitParams calldata params)
        external
        view
        returns (address)
    {
        return MinimalClones.predictDeterministicAddress(
            vaultImplementation, _salt(creator, nonce, params), address(this)
        );
    }

    function setTradeAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0) || adapter.code.length == 0) revert ZeroAddress();
        isTradeAdapterApproved[adapter] = approved;
        emit TradeAdapterApprovalChanged(adapter, approved);
    }

    function setMinTargetWeightBps(uint16 newMinimumBps) external onlyOwner {
        if (newMinimumBps == 0 || newMinimumBps > 10_000) revert InvalidLimit();
        uint16 previousMinimumBps = minTargetWeightBps;
        minTargetWeightBps = newMinimumBps;
        emit MinimumTargetWeightUpdated(previousMinimumBps, newMinimumBps);
    }

    /// @notice Configures the official market registry before the first OTF is created.
    /// @dev It becomes permanently locked as soon as a vault exists.
    function setOfficialMarketRegistry(address registry) external onlyOwner {
        if (_vaults.length != 0) revert OfficialMarketRegistryLocked();
        if (registry == address(0) || registry.code.length == 0) {
            revert InvalidDependency(registry);
        }
        officialMarketRegistry = registry;
        emit OfficialMarketRegistryConfigured(registry);
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

    function _validateFactoryBounds(VaultInitParams calldata params) internal pure {
        uint256 rationaleLength = bytes(params.initialStrategyRationale).length;
        if (rationaleLength == 0) revert StrategyRationaleRequired();
        if (rationaleLength > MAX_STRATEGY_RATIONALE_BYTES) {
            revert StrategyRationaleTooLong(rationaleLength);
        }
        if (params.manager == address(0) || params.feeRecipient == address(0)) {
            revert ZeroAddress();
        }
        if (params.initialShareSupply <= MINIMUM_LIQUIDITY_SHARES) {
            revert InitialShareSupplyTooSmall(
                params.initialShareSupply, MINIMUM_LIQUIDITY_SHARES + 1
            );
        }
        if (params.initialAssets.length != params.initialTargetWeightsBps.length) {
            revert InvalidArrayLength();
        }
        if (params.initialAssets.length != params.initialAmounts.length) {
            revert InvalidArrayLength();
        }
        if (params.creatorFeeBpsPerYear > MAX_CREATOR_FEE_BPS_PER_YEAR) {
            revert CreatorFeeTooHigh(params.creatorFeeBpsPerYear, MAX_CREATOR_FEE_BPS_PER_YEAR);
        }
        if (params.maxOracleStaleness == 0) revert InvalidLimit();
        if (params.maxOracleStaleness > MAX_ORACLE_STALENESS) revert LimitTooHigh();
        if (params.maxTurnoverBps > GLOBAL_MAX_TURNOVER_BPS) revert LimitTooHigh();
        if (params.maxNavLossBps > GLOBAL_MAX_NAV_LOSS_BPS) revert LimitTooHigh();
        if (params.maxWeightDeviationBps == 0) revert InvalidLimit();
        if (params.maxWeightDeviationBps > GLOBAL_MAX_WEIGHT_DEVIATION_BPS) {
            revert LimitTooHigh();
        }
        if (
            params.challengeWeightDeviationBps <= params.maxWeightDeviationBps
                || params.challengeWeightDeviationBps > GLOBAL_MAX_CHALLENGE_WEIGHT_DEVIATION_BPS
        ) {
            revert InvalidLimit();
        }
        if (
            params.challengeGracePeriod < MIN_CHALLENGE_GRACE_PERIOD
                || params.challengeGracePeriod > MAX_CHALLENGE_GRACE_PERIOD
        ) {
            revert InvalidLimit();
        }
    }

    function _transferInitialAssetExact(
        address asset,
        address sender,
        address receiver,
        uint256 amount
    ) internal {
        uint256 senderBefore = IERC20(asset).balanceOf(sender);
        uint256 receiverBefore = IERC20(asset).balanceOf(receiver);
        asset.safeTransferFrom(sender, receiver, amount);
        uint256 senderAfter = IERC20(asset).balanceOf(sender);
        uint256 receiverAfter = IERC20(asset).balanceOf(receiver);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert AssetTransferMismatch(asset, amount, senderDelta, receiverDelta);
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
