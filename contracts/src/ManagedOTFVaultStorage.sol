// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";

interface IOTFFactoryFeePolicy {
    function effectiveProtocolFeeShareBps(address vault) external view returns (uint16);
    function otfTokenURI() external pure returns (string memory);
}

/// @dev Clone-safe vault storage. Formation and fee-policy fields have no mutation path.
abstract contract ManagedOTFVaultStorage is ERC20Upgradeable {
    uint256 internal constant BPS = ProtocolConstants.BPS;
    uint256 internal constant WAD = ProtocolConstants.WAD;
    uint256 internal constant YEAR = ProtocolConstants.YEAR;
    uint256 internal constant FORMATION_SHARE_UNIT = ProtocolConstants.FORMATION_SHARE_UNIT;

    error AlreadyInitialized();
    error NotInitialized();
    error UnauthorizedFactory();
    error UnauthorizedRouter(address caller);
    error UnauthorizedShutdown(address caller);
    error InvalidDependency(address dependency);
    error Reentrancy();
    error ZeroAddress();
    error InvalidReceiver(address receiver);
    error InvalidArrayLength(uint256 expected, uint256 actual);
    error InvalidConstituent(address constituent);
    error DuplicateConstituent(address constituent);
    error InvalidRelativeQuantity(address constituent);
    error InvalidFormationMetadata(uint16 formationOtfWeightBps, uint32 calculationVersion);
    error ExpenseRatioTooHigh(uint16 supplied, uint16 maximum);
    error ZeroShares();
    error SharesExceedSupply(uint256 shares, uint256 supply);
    error BootstrapSharesTooSmall(uint256 supplied, uint256 minimum);
    error AmountTooHigh(address asset, uint256 required, uint256 maximum);
    error AmountTooLow(address asset, uint256 actual, uint256 minimum);
    error AssetTransferMismatch(
        address asset, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error BackingDeficient(address asset, uint256 accounted, uint256 actual);
    error BasketBalanceChanged(address asset, uint256 expected, uint256 actual);
    error BasketAccountBalanceChanged(
        address asset, address account, uint256 expected, uint256 actual
    );
    error VaultShutdown();
    error VaultNotShutdown();

    event VaultInitialized(
        address indexed factory,
        address indexed creator,
        address indexed expenseBeneficiary,
        bytes32 formationSnapshotDigest
    );
    event BasketMinted(
        address indexed router, address indexed receiver, uint256 shares, uint256[] amountsIn
    );
    event BasketRedeemed(
        address indexed router,
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256[] amountsOut
    );
    event EmergencyRedeemed(
        address indexed owner, address indexed receiver, uint256 shares, uint256[] amountsOut
    );
    event ExpenseFeesCheckpointed(
        uint256 totalFeeShares,
        uint256 creatorShares,
        uint256 protocolShares,
        uint16 effectiveProtocolShareBps
    );
    event EmergencyShutdown(address indexed caller, uint64 timestamp);

    bool internal _initialized;
    bool internal _shutdown;
    uint256 internal _entered;

    address internal _factory;
    address internal _creator;
    address internal _expenseBeneficiary;
    address internal _feeCollector;
    address internal _entryExitRouter;

    uint16 internal _annualCreatorExpenseRatioBps;
    uint16 internal _formationOtfWeightBps;
    uint64 internal _formationSnapshotTime;
    uint32 internal _formationCalculationVersion;
    bytes32 internal _formationSnapshotDigest;
    uint64 internal _shutdownAt;

    address[] internal _assets;
    mapping(address => uint256) internal _relativeQuantity;
    mapping(address => uint256) internal _accountedBalance;

    // Manual fee checkpoints do not reset this epoch, making growth independent of checkpoint cadence.
    uint64 internal _feeEpochTimestamp;
    uint64 internal _lastFeeCheckpointTimestamp;
    uint256 internal _feeEpochSupply;
    uint256 internal _feeEpochAccruedShares;
    uint256 internal _feeShareRemainderWad;
    uint16 internal _protocolFeeSplitRemainderBps;

    modifier onlyInitialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != _entryExitRouter) revert UnauthorizedRouter(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }
}
