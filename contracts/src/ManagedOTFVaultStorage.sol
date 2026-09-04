// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";

interface IOTFFactoryTokenPolicy {
    function otfToken() external view returns (address);
    function buybackCollector() external view returns (address);
    function entryExitRouter() external view returns (address);
    function otfTokenURI() external pure returns (string memory);
}

/// @dev Clone-safe vault storage. Bootstrap basket units and fee policy have no mutation path.
abstract contract ManagedOTFVaultStorage is ERC20Upgradeable {
    uint256 internal constant BPS = ProtocolConstants.BPS;
    uint256 internal constant WAD = ProtocolConstants.WAD;
    uint256 internal constant YEAR = ProtocolConstants.YEAR;
    uint256 internal constant MINIMUM_SHARE_SUPPLY = ProtocolConstants.MINIMUM_SHARE_SUPPLY;

    error NotInitialized();
    error UnauthorizedFactory();
    error UnauthorizedRouter(address caller);
    error UnauthorizedShutdown(address caller);
    error InvalidDependency(address dependency);
    error Reentrancy();
    error ZeroAddress();
    error InvalidReceiver(address receiver);
    error InvalidVaultMetadata();
    error FundThesisRequired();
    error FundThesisTooLong(uint256 suppliedBytes, uint256 maximumBytes);
    error InvalidArrayLength(uint256 expected, uint256 actual);
    error InvalidConstituent(address constituent);
    error DuplicateConstituent(address constituent);
    error InvalidBootstrapBasketUnit(address constituent);
    error ExpenseRatioTooHigh(uint16 supplied, uint16 maximum);
    error MintFeeTooHigh(uint16 supplied, uint16 maximum);
    error RedeemFeeTooHigh(uint16 supplied, uint16 maximum);
    error ZeroShares();
    error ZeroNetShares();
    error SharesExceedSupply(uint256 shares, uint256 supply);
    error BootstrapSharesTooSmall(uint256 supplied, uint256 minimum);
    error InvalidSkipMask(uint256 skipMask, uint256 constituentCount);
    error SkippedAssetMinimumNotZero(address asset, uint256 minimum);
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

    event VaultInitialized(
        address indexed factory, address indexed creator, address indexed expenseBeneficiary
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
    event InKindRedeemed(
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256[] amountsOut,
        uint256[] forfeitedAmounts,
        uint256 skipMask
    );
    event ExpenseFeesCheckpointed(
        uint256 totalFeeShares, uint256 creatorShares, uint256 buybackShares, uint16 creatorShareBps
    );
    event MintFeeCharged(
        uint256 grossShares,
        uint256 investorShares,
        uint256 creatorShares,
        uint256 buybackShares,
        uint16 creatorShareBps
    );
    event RedeemFeeCharged(
        uint256 investorShares,
        uint256 redeemedShares,
        uint256 creatorShares,
        uint256 buybackShares,
        uint16 creatorShareBps
    );
    event EmergencyShutdown(address indexed caller, uint64 timestamp);
    event LowSupplyShutdown(address indexed caller, uint64 timestamp, uint256 remainingSupply);

    bool internal _shutdown;
    uint256 internal _entered;

    address internal _factory;
    address internal _creator;
    address internal _expenseBeneficiary;
    address internal _buybackCollector;
    address internal _entryExitRouter;
    address internal _otfToken;
    string internal _fundThesis;

    uint16 internal _annualCreatorExpenseRatioBps;
    uint16 internal _mintFeeBps;
    uint16 internal _redeemFeeBps;
    uint64 internal _shutdownAt;

    address[] internal _assets;
    mapping(address => uint256) internal _bootstrapBasketUnitsPerOTF;
    mapping(address => uint256) internal _accountedBalance;

    // Manual fee checkpoints do not reset this epoch, making growth independent of checkpoint cadence.
    uint64 internal _feeEpochTimestamp;
    uint64 internal _lastFeeCheckpointTimestamp;
    uint256 internal _feeEpochSupply;
    uint256 internal _feeEpochAccruedShares;
    uint256 internal _feeShareRemainderWad;
    uint256 internal _expenseCreatorSplitRemainderBps;

    modifier onlyInitialized() {
        if (_factory == address(0)) revert NotInitialized();
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
