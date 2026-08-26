// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "./interfaces/IERC20.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { ManagedOTFVault } from "./ManagedOTFVault.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { VaultInitParams } from "./VaultTypes.sol";

interface IFeeCollectorTreasury {
    function treasury() external view returns (address);
    function pendingTreasury() external view returns (address);
}

interface IProtocolTokenWeight {
    function targetWeightBps(address token) external view returns (uint16 weightBps);
    function currentWeight(address token) external view returns (uint256 weightBps);
}

interface IAssetPricingResolverDependencies {
    function marketRegistry() external view returns (address);
}

contract OTFFactory is IAdapterAllowlist {
    string private constant OTF_TOKEN_METADATA_URI = "data:application/json;base64,eyJpbnRlcm9wIjp7ImVyYzEwNDYiOnRydWV9LCJkZXNjcmlwdGlvbiI6IkFuIE9uY2h"
        "haW4gVHJhZGVkIEZ1bmQgRVJDLTIwIHNoYXJlIHRva2VuLiIsImltYWdlIjoiZGF0YTppbWFnZS9zdmcreG1sO2Jhc2U2NCx"
        "QSE4yWnlCNGJXeHVjejBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TWpBd01DOXpkbWNpSUhacFpYZENiM2c5SWpBZ01DQXl"
        "OVFlnTWpVMklqNDhjbVZqZENCNFBTSTNJaUI1UFNJM0lpQjNhV1IwYUQwaU1qUXlJaUJvWldsbmFIUTlJakkwTWlJZ2NuZzl"
        "JalEwSWlCbWFXeHNQU0lqTVRNeU5qSTFJaUJ6ZEhKdmEyVTlJaU16TjJJM1lXRWlJSE4wY205clpTMXZjR0ZqYVhSNVBTSXV"
        "OamdpSUhOMGNtOXJaUzEzYVdSMGFEMGlOU0l2UGp4d1lYUm9JR1pwYkd3OUlpTTNZbVE0WTJVaUlHWnBiR3d0Y25Wc1pUMGl"
        "aWFpsYm05a1pDSWdaRDBpVFRNNUlEZ3lhRFl3ZGpreVNETTVWamd5V20weE55QXhOM1kxT0dneU5sWTVPVWcxTmxvaUx6NDh"
        "jR0YwYUNCbWFXeHNQU0lqTjJKa09HTmxJaUJrUFNKTk1UQTJJRGd5YURVM2RqRTNhQzB5TUhZM05XZ3RNVGRXT1Rsb0xUSXd"
        "Wamd5V20wMk5DQXdhRFE1ZGpFM2FDMHpNbll5TVdneU9IWXhOMmd0TWpoMk16ZG9MVEUzVmpneVdpSXZQand2YzNablBnPT0"
        "ifQ==";
    using SafeTransferLib for address;

    uint16 public constant MAX_MANAGER_FEE_BPS_PER_YEAR =
        ProtocolConstants.MAX_ANNUAL_MANAGER_FEE_BPS;
    uint256 public constant MAX_TRACKED_ASSETS = ProtocolConstants.MAX_TRACKED_ASSETS;
    uint16 public constant MAX_PROTOCOL_FEE_SHARE_BPS = 10_000;
    uint16 public constant GLOBAL_MAX_NAV_LOSS_BPS = 200;
    uint16 public constant MIN_TARGET_WEIGHT_BPS = 10; // 0.1%
    uint256 public constant MINIMUM_INITIAL_SHARE_SUPPLY = 1e18;
    uint256 public constant MAX_INITIAL_SHARE_SUPPLY = ProtocolConstants.MAX_INITIAL_SHARE_SUPPLY;
    uint32 public constant MIN_CHALLENGE_GRACE_PERIOD = 1 days;
    uint32 public constant MAX_CHALLENGE_GRACE_PERIOD = 30 days;

    error NotOwner();
    error ZeroAddress();
    error InvalidImplementation();
    error InvalidDependency(address dependency);
    error InitialShareSupplyTooSmall(uint256 supplied, uint256 minimum);
    error InitialShareSupplyTooLarge(uint256 supplied, uint256 maximum);
    error ManagerFeeTooHigh(uint16 feeBps, uint16 maximum);
    error TrackedAssetLimitExceeded();
    error ProtocolFeeShareTooHigh(uint16 shareBps, uint16 maximum);
    error LimitTooHigh();
    error InvalidLimit();
    error InvalidArrayLength();
    error InvalidOTFName();
    error StrategyRationaleRequired();
    error StrategyRationaleTooLong(uint256 length);
    error Reentrancy();
    error AssetTransferMismatch(
        address asset, uint256 expected, uint256 senderDelta, uint256 receiverDelta
    );
    error DepositsPaused();
    error InvalidVault(address vault);
    error ProtocolTokenAlreadyConfigured();
    error ProtocolTokenNotConfigured();
    error InvalidProtocolTokenThreshold(uint16 thresholdBps);

    event VaultCreated(address indexed creator, address indexed vault, string name, string symbol);
    event TradeAdapterApprovalChanged(address indexed adapter, bool approved);
    event ProtocolFeeShareUpdated(uint16 previousShareBps, uint16 newShareBps);
    event ChallengeGracePeriodUpdated(uint32 previousPeriod, uint32 newPeriod);
    event MinimumTargetWeightUpdated(uint16 previousMinimumBps, uint16 newMinimumBps);
    event WeightBandLimitsUpdated(
        uint16 minCompletionDeviationBps,
        uint16 maxCompletionDeviationBps,
        uint16 minChallengeDeviationGapBps,
        uint16 maxChallengeDeviationBps
    );
    event DepositsPauseChanged(bool paused);
    event VaultDepositsPauseChanged(address indexed vault, bool paused);
    event ProtocolTokenConfigured(address indexed token, uint16 fullRebateBps);
    event ProtocolTokenFullRebateThresholdChanged(
        uint16 previousThresholdBps, uint16 newThresholdBps
    );
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    address public owner;
    address public pendingOwner;
    address public immutable vaultImplementation;
    address public immutable feeCollector;
    address public immutable rebalanceExecutor;
    address public immutable assetMarketRegistry;
    address public immutable pricingResolver;
    uint16 public protocolFeeShareBps;
    uint32 public challengeGracePeriod = 7 days;
    uint16 public minTargetWeightBps = 100; // 1%
    uint16 public minCompletionDeviationBps = 25;
    uint16 public maxCompletionDeviationBps = 500;
    uint16 public minChallengeDeviationGapBps = 25;
    uint16 public maxChallengeDeviationBps = 1_500;
    address public protocolToken;
    uint16 public protocolTokenFullRebateBps;
    bool public depositsPaused;

    address[] private _vaults;
    mapping(address => bool) public isVault;
    mapping(address => bool) public isTradeAdapterApproved;
    mapping(address => bool) public vaultDepositsPaused;
    bool private _creating;
    address private _vaultBeingCreated;

    constructor(
        address vaultImplementation_,
        address feeCollector_,
        address rebalanceExecutor_,
        address pricingResolver_,
        uint16 protocolFeeShareBps_
    ) {
        if (vaultImplementation_.code.length == 0) {
            revert InvalidImplementation();
        }
        if (
            feeCollector_ == address(0) || rebalanceExecutor_ == address(0)
                || pricingResolver_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (feeCollector_.code.length == 0) revert InvalidDependency(feeCollector_);
        if (rebalanceExecutor_.code.length == 0) revert InvalidDependency(rebalanceExecutor_);
        if (pricingResolver_.code.length == 0) revert InvalidDependency(pricingResolver_);
        if (protocolFeeShareBps_ > MAX_PROTOCOL_FEE_SHARE_BPS) {
            revert ProtocolFeeShareTooHigh(protocolFeeShareBps_, MAX_PROTOCOL_FEE_SHARE_BPS);
        }

        owner = msg.sender;
        vaultImplementation = vaultImplementation_;
        feeCollector = feeCollector_;
        rebalanceExecutor = rebalanceExecutor_;
        pricingResolver = pricingResolver_;
        address marketRegistry =
            IAssetPricingResolverDependencies(pricingResolver_).marketRegistry();
        if (marketRegistry != address(0) && marketRegistry.code.length == 0) {
            revert InvalidDependency(marketRegistry);
        }
        assetMarketRegistry = marketRegistry;
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

    function createVault(VaultInitParams calldata params)
        external
        nonReentrantCreation
        returns (address vault)
    {
        if (depositsPaused) revert DepositsPaused();
        _validateFactoryBounds(params);

        for (uint256 i = 0; i < params.initialAssets.length; i++) {
            _transferInitialAssetExact(
                params.initialAssets[i], msg.sender, address(this), params.initialAmounts[i]
            );
        }

        vault = Clones.clone(vaultImplementation);
        _vaultBeingCreated = vault;
        ManagedOTFVault(vault).initialize(params);
        _vaultBeingCreated = address(0);

        isVault[vault] = true;
        _vaults.push(vault);

        emit VaultCreated(msg.sender, vault, params.name, params.symbol);
    }

    /// @dev Called only by the clone currently being initialized. The factory remains the spender
    ///      approved by the creator while the vault receives the assets before minting shares.
    function provideInitialAssets(address[] calldata assets, uint256[] calldata amounts) external {
        if (msg.sender != _vaultBeingCreated) revert InvalidVault(msg.sender);
        if (assets.length != amounts.length) revert InvalidArrayLength();
        for (uint256 i = 0; i < assets.length; i++) {
            _transferInitialAssetExact(assets[i], address(this), msg.sender, amounts[i]);
        }
    }

    function setTradeAdapterApproved(address adapter, bool approved) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (approved && adapter.code.length == 0) revert InvalidDependency(adapter);
        isTradeAdapterApproved[adapter] = approved;
        emit TradeAdapterApprovalChanged(adapter, approved);
    }

    /// @notice Changes the protocol's share of manager fees for all existing and future OTFs.
    function setProtocolFeeShareBps(uint16 newShareBps) external onlyOwner {
        if (newShareBps > MAX_PROTOCOL_FEE_SHARE_BPS) {
            revert ProtocolFeeShareTooHigh(newShareBps, MAX_PROTOCOL_FEE_SHARE_BPS);
        }
        uint16 previousShareBps = protocolFeeShareBps;
        protocolFeeShareBps = newShareBps;
        emit ProtocolFeeShareUpdated(previousShareBps, newShareBps);
    }

    function setChallengeGracePeriod(uint32 newPeriod) external onlyOwner {
        if (newPeriod < MIN_CHALLENGE_GRACE_PERIOD || newPeriod > MAX_CHALLENGE_GRACE_PERIOD) {
            revert InvalidLimit();
        }
        uint32 previousPeriod = challengeGracePeriod;
        challengeGracePeriod = newPeriod;
        emit ChallengeGracePeriodUpdated(previousPeriod, newPeriod);
    }

    function setMinTargetWeightBps(uint16 newMinimumBps) external onlyOwner {
        if (newMinimumBps < MIN_TARGET_WEIGHT_BPS || newMinimumBps > 10_000) {
            revert InvalidLimit();
        }
        uint16 fullRebateBps = protocolTokenFullRebateBps;
        if (fullRebateBps != 0 && newMinimumBps > fullRebateBps) {
            revert InvalidProtocolTokenThreshold(fullRebateBps);
        }
        uint16 previousMinimumBps = minTargetWeightBps;
        minTargetWeightBps = newMinimumBps;
        emit MinimumTargetWeightUpdated(previousMinimumBps, newMinimumBps);
    }

    function setWeightBandLimits(
        uint16 newMinCompletionDeviationBps,
        uint16 newMaxCompletionDeviationBps,
        uint16 newMinChallengeDeviationGapBps,
        uint16 newMaxChallengeDeviationBps
    ) external onlyOwner {
        _validateWeightBandLimits(
            newMinCompletionDeviationBps,
            newMaxCompletionDeviationBps,
            newMinChallengeDeviationGapBps,
            newMaxChallengeDeviationBps
        );
        minCompletionDeviationBps = newMinCompletionDeviationBps;
        maxCompletionDeviationBps = newMaxCompletionDeviationBps;
        minChallengeDeviationGapBps = newMinChallengeDeviationGapBps;
        maxChallengeDeviationBps = newMaxChallengeDeviationBps;
        emit WeightBandLimitsUpdated(
            newMinCompletionDeviationBps,
            newMaxCompletionDeviationBps,
            newMinChallengeDeviationGapBps,
            newMaxChallengeDeviationBps
        );
    }

    /// @notice Reversibly pauses new OTF creation and primary deposits across every factory OTF.
    /// @dev Redemptions, share transfers, and secondary-market trading remain available.
    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPauseChanged(paused);
    }

    /// @notice Reversibly pauses primary deposits into one factory-created OTF.
    /// @dev Withdrawals, transfers, strategy operations, challenges, and fees are unaffected.
    function setVaultDepositsPaused(address vault, bool paused) external onlyOwner {
        if (!isVault[vault]) revert InvalidVault(vault);
        vaultDepositsPaused[vault] = paused;
        emit VaultDepositsPauseChanged(vault, paused);
    }

    /// @notice Permanently identifies the OTF protocol token used by the fee incentive.
    /// @dev A zero threshold configures the token while leaving the incentive disabled.
    function configureProtocolToken(address token, uint16 fullRebateBps) external onlyOwner {
        if (protocolToken != address(0)) revert ProtocolTokenAlreadyConfigured();
        if (token == address(0) || token.code.length == 0) revert InvalidDependency(token);
        _validateProtocolTokenThreshold(fullRebateBps);
        protocolToken = token;
        protocolTokenFullRebateBps = fullRebateBps;
        emit ProtocolTokenConfigured(token, fullRebateBps);
    }

    /// @notice Changes the OTF target weight that earns a full protocol-fee rebate.
    /// @dev The rebate scales linearly below this threshold. Zero disables the incentive.
    function setProtocolTokenFullRebateBps(uint16 newThresholdBps) external onlyOwner {
        if (protocolToken == address(0)) revert ProtocolTokenNotConfigured();
        _validateProtocolTokenThreshold(newThresholdBps);
        uint16 previousThresholdBps = protocolTokenFullRebateBps;
        protocolTokenFullRebateBps = newThresholdBps;
        emit ProtocolTokenFullRebateThresholdChanged(previousThresholdBps, newThresholdBps);
    }

    /// @notice Returns the protocol share after applying the lesser of actual and target OTF weight.
    /// @dev Missing constituents and failed oracle-valued weight reads use the configured share.
    function effectiveProtocolFeeShareBps(address vault)
        external
        view
        returns (uint16 effectiveShareBps)
    {
        effectiveShareBps = protocolFeeShareBps;
        address token = protocolToken;
        uint16 fullRebateBps = protocolTokenFullRebateBps;
        if (token == address(0) || fullRebateBps == 0 || effectiveShareBps == 0) {
            return effectiveShareBps;
        }

        uint256 targetWeightBps;
        try IProtocolTokenWeight(vault).targetWeightBps(token) returns (uint16 weightBps) {
            targetWeightBps = weightBps;
        } catch {
            return effectiveShareBps;
        }
        if (targetWeightBps == 0) return effectiveShareBps;

        uint256 actualWeightBps;
        try IProtocolTokenWeight(vault).currentWeight(token) returns (uint256 weightBps) {
            actualWeightBps = weightBps;
        } catch {
            return effectiveShareBps;
        }

        uint256 rebateWeightBps =
            actualWeightBps < targetWeightBps ? actualWeightBps : targetWeightBps;
        if (rebateWeightBps >= fullRebateBps) return 0;
        uint256 scaledShare =
            uint256(effectiveShareBps) * (uint256(fullRebateBps) - rebateWeightBps) / fullRebateBps;
        // The scaled share cannot exceed the uint16 protocolFeeShareBps value.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(scaledShare);
    }

    function _validateProtocolTokenThreshold(uint16 thresholdBps) private view {
        if (thresholdBps > 10_000 || (thresholdBps != 0 && thresholdBps < minTargetWeightBps)) {
            revert InvalidProtocolTokenThreshold(thresholdBps);
        }
    }

    function otfTokenURI() external pure returns (string memory) {
        return OTF_TOKEN_METADATA_URI;
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

    function _validateFactoryBounds(VaultInitParams calldata params) internal view {
        bytes calldata name = bytes(params.name);
        uint256 nameLength = name.length;
        if (
            nameLength < 4 || name[nameLength - 4] != 0x20 || name[nameLength - 3] != 0x4f
                || name[nameLength - 2] != 0x54 || name[nameLength - 1] != 0x46
        ) {
            revert InvalidOTFName();
        }

        uint256 rationaleLength = bytes(params.initialStrategyRationale).length;
        if (rationaleLength == 0) revert StrategyRationaleRequired();
        if (rationaleLength > ProtocolConstants.MAX_STRATEGY_RATIONALE_BYTES) {
            revert StrategyRationaleTooLong(rationaleLength);
        }
        if (params.manager == address(0) || params.feeRecipient == address(0)) {
            revert ZeroAddress();
        }
        if (params.initialShareSupply < MINIMUM_INITIAL_SHARE_SUPPLY) {
            revert InitialShareSupplyTooSmall(
                params.initialShareSupply, MINIMUM_INITIAL_SHARE_SUPPLY
            );
        }
        if (params.initialShareSupply > MAX_INITIAL_SHARE_SUPPLY) {
            revert InitialShareSupplyTooLarge(params.initialShareSupply, MAX_INITIAL_SHARE_SUPPLY);
        }
        if (params.initialAssets.length > MAX_TRACKED_ASSETS) {
            revert TrackedAssetLimitExceeded();
        }
        if (params.initialAssets.length != params.initialTargetWeightsBps.length) {
            revert InvalidArrayLength();
        }
        if (params.initialAssets.length != params.initialAmounts.length) {
            revert InvalidArrayLength();
        }
        if (params.initialAssets.length != params.initialPricingConfigs.length) {
            revert InvalidArrayLength();
        }
        if (params.managerFeeBpsPerYear > MAX_MANAGER_FEE_BPS_PER_YEAR) {
            revert ManagerFeeTooHigh(params.managerFeeBpsPerYear, MAX_MANAGER_FEE_BPS_PER_YEAR);
        }
        if (params.maxNavLossBps > GLOBAL_MAX_NAV_LOSS_BPS) revert LimitTooHigh();
        _validateWeightBands(params.maxWeightDeviationBps, params.challengeWeightDeviationBps);
    }

    function _validateWeightBandLimits(
        uint16 minimumCompletion,
        uint16 maximumCompletion,
        uint16 minimumChallengeGap,
        uint16 maximumChallenge
    ) private pure {
        if (
            minimumCompletion == 0 || minimumCompletion > maximumCompletion
                || minimumChallengeGap == 0 || maximumCompletion > 10_000
                || minimumChallengeGap > 10_000 || maximumChallenge > 10_000
                || uint256(maximumCompletion) + uint256(minimumChallengeGap)
                    > uint256(maximumChallenge)
        ) {
            revert InvalidLimit();
        }
    }

    function _validateWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps)
        private
        view
    {
        if (
            completionDeviationBps < minCompletionDeviationBps
                || completionDeviationBps > maxCompletionDeviationBps
                || uint256(challengeDeviationBps)
                    < uint256(completionDeviationBps) + uint256(minChallengeDeviationGapBps)
                || challengeDeviationBps > maxChallengeDeviationBps
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
        if (sender == address(this)) asset.safeTransfer(receiver, amount);
        else asset.safeTransferFrom(sender, receiver, amount);
        uint256 senderAfter = IERC20(asset).balanceOf(sender);
        uint256 receiverAfter = IERC20(asset).balanceOf(receiver);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert AssetTransferMismatch(asset, amount, senderDelta, receiverDelta);
        }
    }
}
