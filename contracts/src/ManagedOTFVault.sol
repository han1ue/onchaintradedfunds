// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IProtocolPortfolioLimits,
    IProtocolTokenFeePolicy,
    ManagedOTFVaultStorage
} from "./ManagedOTFVaultStorage.sol";
import { IAssetPricingResolver } from "./AssetPricingResolver.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import {
    AssetPricingConfig,
    PricingSource,
    RebalanceRecord,
    StrategyVersion,
    TradeExecutionRecord,
    TradeInstruction,
    VaultInitParams
} from "./VaultTypes.sol";

contract ManagedOTFVault is ManagedOTFVaultStorage {
    using SafeTransferLib for address;

    PortfolioCalculator private immutable _portfolioCalculator;
    address private immutable _strategyModule;
    bytes32 private immutable _strategyModuleCodehash;
    address private immutable _viewModule;
    bytes32 private immutable _viewModuleCodehash;

    event AssetPricingPinned(
        address indexed asset,
        PricingSource indexed source,
        address indexed priceFeed,
        address quoteToken,
        address primarySource,
        bytes32 marketId
    );

    constructor(
        PortfolioCalculator portfolioCalculator_,
        address strategyModule_,
        address viewModule_
    ) {
        if (address(portfolioCalculator_).code.length == 0) {
            revert AssetNotContract(address(portfolioCalculator_));
        }
        if (strategyModule_.code.length == 0) revert AssetNotContract(strategyModule_);
        if (viewModule_.code.length == 0) revert AssetNotContract(viewModule_);
        _initialized = true;
        _portfolioCalculator = portfolioCalculator_;
        _strategyModule = strategyModule_;
        _strategyModuleCodehash = _strategyModule.codehash;
        _viewModule = viewModule_;
        _viewModuleCodehash = _viewModule.codehash;
    }

    function bindFactory() external {
        if (_initialized) revert AlreadyInitialized();
        if (_factory != address(0)) revert UnauthorizedFactory();
        _factory = msg.sender;
    }

    function initialize(
        VaultInitParams calldata params,
        address factory_,
        address assetRegistry_,
        address assetMarketRegistry_,
        address rebalanceExecutor_,
        address feeCollector_,
        uint16 protocolFeeShareBps_
    ) external nonReentrant {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != factory_ || factory_ == address(0) || _factory != factory_) {
            revert UnauthorizedFactory();
        }
        // The bound _factory is the only initializer and validates roles, dependencies, and all
        // creation-time limits before deploying the clone.
        if (params.manager == address(this) || params.feeRecipient == address(this)) {
            revert InvalidRoleAddress(address(this));
        }
        _initialized = true;
        _initializeERC20(params.name, params.symbol, 18);

        _factory = factory_;
        _manager = params.manager;
        _authorizedExecutor[params.manager] = true;
        _authorizedExecutors.push(params.manager);
        _executorIndexPlusOne[params.manager] = 1;
        _feeRecipient = params.feeRecipient;
        _assetRegistry = assetRegistry_;
        _assetMarketRegistry = assetMarketRegistry_;
        _rebalanceExecutor = rebalanceExecutor_;
        _feeCollector = feeCollector_;
        _creatorFeeBpsPerYear = params.creatorFeeBpsPerYear;
        _protocolFeeShareBps = protocolFeeShareBps_;
        _maxNavLossBps = params.maxNavLossBps;
        _maxWeightDeviationBps = params.maxWeightDeviationBps;
        _challengeWeightDeviationBps = params.challengeWeightDeviationBps;

        _configureInitialPricing(params.initialAssets, params.initialPricingConfigs);
        _validateInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _storeInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _validateInitialBalances(params.initialAssets, params.initialAmounts);

        uint64 timestamp = uint64(block.timestamp);
        _lastFeeAccrualTimestamp = timestamp;
        _lastCompletedStrategyTimestamp = timestamp;

        _strategyVersions.push(
            StrategyVersion({
                proposedAt: timestamp,
                activatedAt: timestamp,
                completedAt: timestamp,
                author: params.manager,
                rationale: params.initialStrategyRationale
            })
        );
        for (uint256 i = 0; i < params.initialAssets.length; i++) {
            _strategyAssets[0].push(params.initialAssets[i]);
            _strategyTargetWeightsBps[0].push(params.initialTargetWeightsBps[i]);
        }

        _mint(address(this), ProtocolConstants.MINIMUM_LIQUIDITY_SHARES);
        _mint(
            params.manager, params.initialShareSupply - ProtocolConstants.MINIMUM_LIQUIDITY_SHARES
        );

        uint256[] memory initialWeights = _weightsAsUint256();
        emit OwnershipTransferred(address(0), params.manager);
        emit Rebalanced(params.initialAssets, initialWeights);
        emit VaultInitialized(factory_, params.manager, params.feeRecipient);
    }

    // ERC-165 / ERC-173

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC173_INTERFACE_ID
            || interfaceId == ERC7621_INTERFACE_ID;
    }

    /// @notice Returns ERC-1046 metadata for this OTF ERC-20 share token.
    function tokenURI() external view returns (string memory) {
        return _protocolOtfTokenURI();
    }

    function owner() external view returns (address) {
        return _manager;
    }

    // Routed protocol reads. The logic and storage interpretation live in ManagedOTFVaultView.
    function assets() external returns (address[] memory value) { value; _delegateView(); }
    function factory() external returns (address value) { value; _delegateView(); }
    function manager() external returns (address value) { value; _delegateView(); }
    function feeRecipient() external returns (address value) { value; _delegateView(); }
    function feeCollector() external returns (address value) { value; _delegateView(); }
    function assetRegistry() external returns (address value) { value; _delegateView(); }
    function rebalanceExecutor() external returns (address value) { value; _delegateView(); }
    function creatorFeeBpsPerYear() external returns (uint16 value) { value; _delegateView(); }
    function protocolFeeShareBps() external returns (uint16 value) { value; _delegateView(); }
    function maxNavLossBps() external returns (uint16 value) { value; _delegateView(); }
    function maxWeightDeviationBps() external returns (uint16 value) { value; _delegateView(); }
    function challengeWeightDeviationBps() external returns (uint16 value) { value; _delegateView(); }
    function lastFeeAccrualTimestamp() external returns (uint64 value) { value; _delegateView(); }
    function lastCompletedStrategyTimestamp() external returns (uint64 value) { value; _delegateView(); }
    function strategicRebalanceStartedAt() external returns (uint64 value) { value; _delegateView(); }
    function pendingStrategyProposedAt() external returns (uint64 value) { value; _delegateView(); }
    function pendingStrategyActivationTime() external returns (uint64 value) { value; _delegateView(); }
    function rebalanceCount() external returns (uint256 value) { value; _delegateView(); }
    function escrowedManagerFeeShares() external returns (uint256 value) { value; _delegateView(); }
    function forfeitedManagerFeeShares() external returns (uint256 value) { value; _delegateView(); }
    function strategicRebalanceActive() external returns (bool value) { value; _delegateView(); }
    function strategyProposalPending() external returns (bool value) { value; _delegateView(); }
    function challengeActive() external returns (bool value) { value; _delegateView(); }
    function challengeCaller() external returns (address value) { value; _delegateView(); }
    function challengeStartedAt() external returns (uint64 value) { value; _delegateView(); }
    function challengeDeadline() external returns (uint64 value) { value; _delegateView(); }
    function targetWeightBps(address asset) external returns (uint16 value) { asset; value; _delegateView(); }
    function authorizedExecutor(address executor) external returns (bool value) {
        executor; value; _delegateView();
    }
    function challengeRewardShares(address account) external returns (uint256 value) {
        account; value; _delegateView();
    }
    function sunset() external returns (bool value) { value; _delegateView(); }
    function sunsetAt() external returns (uint64 value) { value; _delegateView(); }
    function tradeExecutionCount() external returns (uint256 value) { value; _delegateView(); }
    function pendingManager() external returns (address value) { value; _delegateView(); }

    function transferOwnership(address newOwner) external {
        newOwner;
        _delegateStrategy();
    }

    function acceptOwnership() external {
        _delegateStrategy();
    }

    // ERC-7621 views

    function getConstituents()
        external
        returns (address[] memory tokens, uint256[] memory weights)
    {
        tokens;
        weights;
        _delegateView();
    }

    function totalConstituents() external returns (uint256 count) {
        count;
        _delegateView();
    }

    function getReserve(address token) public returns (uint256 balance) {
        token;
        balance;
        _delegateView();
    }

    function getWeight(address token) external returns (uint256 weight) {
        token;
        weight;
        _delegateView();
    }

    function isConstituent(address token) public returns (bool constituent) {
        token;
        constituent;
        _delegateView();
    }

    function totalBasketValue() public returns (uint256 value) {
        value;
        _delegateView();
    }

    // Protocol views

    function assetMarketRegistry() external returns (address registry) {
        registry;
        _delegateView();
    }

    function marketIdForAsset(address asset) external returns (bytes32 marketId) {
        asset;
        marketId;
        _delegateView();
    }

    function priceFeedForAsset(address asset) external returns (address feed) {
        asset;
        feed;
        _delegateView();
    }

    function pricingConfigForAsset(address asset)
        external
        returns (
            bool configured,
            PricingSource source,
            address quoteToken,
            address primarySource,
            address secondarySource,
            address normalizedPriceFeed,
            uint32 primaryMaxStaleness,
            uint32 secondaryMaxStaleness
        )
    {
        asset;
        configured;
        source;
        quoteToken;
        primarySource;
        secondarySource;
        normalizedPriceFeed;
        primaryMaxStaleness;
        secondaryMaxStaleness;
        _delegateView();
    }

    function maxStalenessForAsset(address asset) external returns (uint32 maxStaleness) {
        asset;
        maxStaleness;
        _delegateView();
    }

    function pricingSourceForAsset(address asset) external returns (PricingSource source) {
        asset;
        source;
        _delegateView();
    }

    function pruneRetiredAssets() external returns (uint256 removed) {
        removed;
        _delegateStrategy();
    }

    function totalAssetsValue() public returns (uint256 nav) {
        nav;
        _delegateView();
    }

    function navPerShare() external returns (uint256 nav) {
        nav;
        _delegateView();
    }

    function currentWeightsBps() public returns (uint16[] memory weights) {
        weights;
        _delegateView();
    }

    function currentWeight(address token) public returns (uint256 weight) {
        token;
        weight;
        _delegateView();
    }

    function getWeightBands(address token)
        external
        returns (
            uint256 challengeLower,
            uint256 challengeUpper,
            uint256 completionLower,
            uint256 completionUpper
        )
    {
        token;
        challengeLower;
        challengeUpper;
        completionLower;
        completionUpper;
        _delegateView();
    }

    function isWithinTargetBands() public returns (bool withinBands) {
        withinBands;
        _delegateView();
    }

    function isWithinChallengeBands() public returns (bool withinBands) {
        withinBands;
        _delegateView();
    }

    function canProposeStrategy() public returns (bool allowed) {
        allowed;
        _delegateView();
    }

    function challengeTimeRemaining() external returns (uint256 remaining) {
        remaining;
        _delegateView();
    }

    function nextStrategyChangeTime() public returns (uint256 timestamp) {
        timestamp;
        _delegateView();
    }

    function feeState() public returns (FeeState state) {
        state;
        _delegateView();
    }

    /// @notice Protocol fee share after the actual-and-target OTF weight incentive is applied.
    /// @dev Missing constituents and failed oracle-valued weight reads preserve the base fee share.
    function effectiveProtocolFeeShareBps() public view returns (uint16 effectiveShareBps) {
        return IProtocolTokenFeePolicy(_factory).effectiveProtocolFeeShareBps(address(this));
    }

    function authorizedExecutors() external returns (address[] memory executors) {
        executors;
        _delegateView();
    }

    function recentRebalanceCount() external returns (uint256 count) {
        count;
        _delegateView();
    }

    function recentRebalanceRecord(uint256 index) external returns (RebalanceRecord memory record) {
        index;
        record;
        _delegateView();
    }

    function navLossBudgetState()
        external
        returns (uint64 recoveryAt, uint16 usedLossBps, uint16 maximumLossBps)
    {
        recoveryAt;
        usedLossBps;
        maximumLossBps;
        _delegateView();
    }

    function recentTradeExecutionCount() external returns (uint256 count) {
        count;
        _delegateView();
    }

    function recentTradeExecutionRecord(uint256 index)
        external
        returns (TradeExecutionRecord memory record)
    {
        index;
        record;
        _delegateView();
    }

    // ERC-7621 entry and exit

    function previewContribute(uint256[] calldata amounts) public returns (uint256 lpAmount) {
        amounts;
        lpAmount;
        _delegateView();
    }

    function contribute(uint256[] calldata amounts, address receiver, uint256 minShares)
        external
        onlyInitialized
        nonReentrant
        returns (uint256 lpAmount)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (amounts.length != _assets.length) {
            revert LengthMismatch(_assets.length, amounts.length);
        }
        bool anyAmount;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] != 0) {
                anyAmount = true;
                break;
            }
        }
        if (!anyAmount) revert ZeroAmount();

        _requireDepositsOpen();
        _accrueFees();
        lpAmount = _previewContributeCurrentSupply(amounts);
        if (lpAmount < minShares) revert InsufficientShares(minShares, lpAmount);
        if (lpAmount == 0) revert InsufficientShares(1, 0);

        // Pull and verify every constituent before minting. This avoids exposing temporarily
        // unbacked shares during token callbacks; the guard blocks nested vault mutations.
        for (uint256 i = 0; i < _assets.length; i++) {
            _pullExact(_assets[i], msg.sender, amounts[i]);
        }
        _mint(receiver, lpAmount);
        emit Contributed(msg.sender, receiver, lpAmount, amounts);
    }

    function previewWithdraw(uint256 lpAmount) public returns (uint256[] memory amounts) {
        lpAmount;
        amounts;
        _delegateView();
    }

    function withdraw(uint256 lpAmount, address receiver, uint256[] calldata minAmounts)
        external
        onlyInitialized
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (lpAmount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (minAmounts.length != _assets.length) {
            revert LengthMismatch(_assets.length, minAmounts.length);
        }
        _accrueFees();
        amounts = _withdraw(lpAmount, receiver, msg.sender, minAmounts);
        emit Withdrawn(msg.sender, receiver, lpAmount, amounts);
    }

    // Existing explicit-share convenience entry and delegated exit

    function previewMint(uint256 shares) public returns (uint256[] memory amountsIn) {
        shares;
        amountsIn;
        _delegateView();
    }

    function previewRedeem(uint256 shares) public returns (uint256[] memory amountsOut) {
        shares;
        amountsOut;
        _delegateView();
    }

    function mintWithBasket(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        onlyInitialized
        nonReentrant
        returns (uint256[] memory amountsIn)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        if (maxAmountsIn.length != _assets.length) revert InvalidArrayLength();

        _requireDepositsOpen();
        _accrueFees();
        uint256 supply = _totalSupply;
        amountsIn = new uint256[](_assets.length);
        // Pull and verify every constituent before minting. Any later failure atomically reverts
        // all transfers, while the guard prevents a token callback from entering the vault again.
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 required = Math.mulDiv(
                shares, IERC20(asset).balanceOf(address(this)), supply, Math.Rounding.Ceil
            );
            if (required > maxAmountsIn[i]) revert AmountTooHigh(asset, required, maxAmountsIn[i]);
            amountsIn[i] = required;
            _pullExact(asset, msg.sender, required);
        }
        _mint(receiver, shares);
        emit Contributed(msg.sender, receiver, shares, amountsIn);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address shareOwner,
        uint256[] calldata minAmountsOut
    ) external onlyInitialized nonReentrant returns (uint256[] memory amountsOut) {
        if (receiver == address(0) || shareOwner == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        if (minAmountsOut.length != _assets.length) revert InvalidArrayLength();
        _accrueFees();
        amountsOut = _withdraw(shares, receiver, shareOwner, minAmountsOut);
        emit Withdrawn(msg.sender, receiver, shares, amountsOut);
    }

    function withdrawManagerFees() external returns (uint256 feeShares) {
        feeShares;
        _delegateStrategy();
    }

    function claimChallengeReward() external returns (uint256) {
        _delegateStrategy();
    }

    // Strategy authority

    function setNextStrategyRationale(string calldata rationale) external {
        rationale;
        _delegateStrategy();
    }

    function setManagerFeeBps(uint16 newFeeBps) external {
        newFeeBps;
        _delegateStrategy();
    }

    function setWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps_) external {
        completionDeviationBps;
        challengeDeviationBps_;
        _delegateStrategy();
    }

    function setExecutor(address executor, bool authorized) external onlyManager {
        if (executor == address(0) || executor == address(this)) {
            revert InvalidRoleAddress(executor);
        }
        if (authorized) {
            if (_authorizedExecutor[executor]) revert ExecutorAlreadyAuthorized(executor);
            if (_authorizedExecutors.length >= MAX_AUTHORIZED_EXECUTORS) {
                revert ExecutorLimitReached();
            }
            _authorizedExecutor[executor] = true;
            _authorizedExecutors.push(executor);
            _executorIndexPlusOne[executor] = _authorizedExecutors.length;
        } else {
            if (!_authorizedExecutor[executor]) revert ExecutorNotAuthorized(executor);
            uint256 index = _executorIndexPlusOne[executor] - 1;
            uint256 lastIndex = _authorizedExecutors.length - 1;
            if (index != lastIndex) {
                address moved = _authorizedExecutors[lastIndex];
                _authorizedExecutors[index] = moved;
                _executorIndexPlusOne[moved] = index + 1;
            }
            _authorizedExecutors.pop();
            delete _executorIndexPlusOne[executor];
            _authorizedExecutor[executor] = false;
        }
        emit ExecutorAuthorizationChanged(executor, authorized);
    }

    function setFeeRecipient(address newFeeRecipient) external {
        newFeeRecipient;
        _delegateStrategy();
    }

    /// @notice Permanently ends deposits, fee accrual, challenges, and portfolio management.
    /// @dev Redemptions and ordinary ERC-20 share transfers remain available for an orderly wind-down.
    function sunsetOtf() external {
        _delegateStrategy();
    }

    // ERC-7621 rebalance changes targets only. Trades and completion are separate calls.

    function rebalance(address[] calldata newTokens, uint256[] calldata newWeights) external {
        newTokens;
        newWeights;
        _delegateStrategy();
    }

    function proposeStrategy(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        string calldata rationale
    ) external {
        newTokens;
        newWeights;
        rationale;
        _delegateStrategy();
    }

    function proposeStrategyWithPricing(
        address[] calldata newTokens,
        uint256[] calldata newWeights,
        AssetPricingConfig[] calldata pricingConfigs,
        string calldata rationale
    ) external {
        newTokens;
        newWeights;
        pricingConfigs;
        rationale;
        _delegateStrategy();
    }

    // Unknown selectors are routed only to the immutable, read-only extension module.
    // solhint-disable-next-line no-complex-fallback
    fallback() external {
        _delegateView();
    }

    function activatePendingStrategy() external {
        _delegateStrategy();
    }

    function cancelPendingStrategy() external {
        _delegateStrategy();
    }

    function executeRebalanceTrades(TradeInstruction[] calldata trades) external {
        trades;
        _delegateStrategy();
    }

    function completeStrategicRebalance() external {
        _delegateStrategy();
    }

    // Permissionless challenge

    function flagOutOfBand() external {
        _delegateStrategy();
    }

    function resolveOutOfBandChallenge() external {
        _delegateStrategy();
    }

    function moduleAccrueFees() external returns (uint256) {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        return _accrueFees();
    }

    function moduleReleaseChallengeFees() external returns (uint256) {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        return _releaseChallengeFees();
    }

    function strategyModule() external view returns (address) {
        return _strategyModule;
    }

    function strategyModuleCodehash() external view returns (bytes32) {
        return _strategyModuleCodehash;
    }

    function viewModule() external view returns (address) {
        return _viewModule;
    }

    function viewModuleCodehash() external view returns (bytes32) {
        return _viewModuleCodehash;
    }

    // Internal share accounting

    function _previewContributeCurrentSupply(uint256[] calldata amounts)
        internal
        view
        returns (uint256 lpAmount)
    {
        if (amounts.length != _assets.length) {
            revert LengthMismatch(_assets.length, amounts.length);
        }
        uint256 supply = _totalSupply;
        lpAmount = type(uint256).max;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            if (reserve == 0) {
                if (amounts[i] != 0) {
                    revert NonProportionalContribution(_assets[i], amounts[i], 0);
                }
                continue;
            }
            uint256 candidate = Math.mulDiv(amounts[i], supply, reserve);
            if (candidate < lpAmount) lpAmount = candidate;
        }
        if (lpAmount == type(uint256).max) return 0;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            uint256 required = Math.mulDiv(lpAmount, reserve, supply, Math.Rounding.Ceil);
            if (amounts[i] != required) {
                revert NonProportionalContribution(_assets[i], amounts[i], required);
            }
        }
    }

    function _withdraw(
        uint256 shares,
        address receiver,
        address shareOwner,
        uint256[] calldata minimums
    ) internal returns (uint256[] memory amounts) {
        uint256 supply = _totalSupply;
        amounts = new uint256[](_assets.length);
        if (shareOwner != msg.sender) _spendAllowance(shareOwner, msg.sender, shares);
        _burn(shareOwner, shares);

        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 amount = Math.mulDiv(shares, IERC20(asset).balanceOf(address(this)), supply);
            if (amount < minimums[i]) {
                revert InsufficientAmount(i, minimums[i], amount);
            }
            amounts[i] = amount;
            _pushExact(asset, receiver, amount);
        }
    }

    // Fee state machine

    function _accrueFees() internal returns (uint256 feeShares) {
        if (_sunset) return 0;
        uint64 previousTimestamp = _lastFeeAccrualTimestamp;
        uint256 elapsed = block.timestamp - uint256(previousTimestamp);
        if (_challengeActive) {
            // Challenge fee checkpoints intentionally use the onchain deadline.
            // forge-lint: disable-next-line(block-timestamp)
            uint256 currentTimestamp = block.timestamp;
            uint256 checkpoint = currentTimestamp < _challengeDeadline
                ? currentTimestamp
                : uint256(_challengeDeadline);
            if (checkpoint > previousTimestamp) {
                feeShares = _escrowChallengeFees(checkpoint - previousTimestamp);
                // Chain timestamps fit uint64 for the lifetime of the protocol.
                // forge-lint: disable-next-line(unsafe-typecast)
                _lastFeeAccrualTimestamp = uint64(checkpoint);
            }
            // Fee forfeiture is intentionally keyed to the onchain challenge deadline.
            if (currentTimestamp > _challengeDeadline) _forfeitChallengeFees();
            return feeShares;
        }
        if (elapsed == 0) return 0;

        feeShares = _mintFees(elapsed);
        // Fractional share-wei are retained in vault storage, so even a zero-share checkpoint can
        // safely close the interval. This creates a hard, non-retroactive boundary for deposits,
        // exits, and fee-rate changes.
        _lastFeeAccrualTimestamp = uint64(block.timestamp);
    }

    function _mintFees(uint256 elapsed) internal returns (uint256 feeShares) {
        uint256 supply = _totalSupply;
        uint16 feeBps = _creatorFeeBpsPerYear;
        if (supply == 0 || feeBps == 0 || elapsed == 0) return 0;
        uint256 remainderAfterWad;
        (feeShares, remainderAfterWad) = _portfolioCalculator.feeSharesAfterElapsed(
            supply, _feeAccrualRemainderWad, feeBps, elapsed
        );
        _feeAccrualRemainderWad = remainderAfterWad;
        if (feeShares == 0) return 0;

        (uint256 managerShares, uint256 protocolShares) = _splitFeeShares(feeShares);
        if (protocolShares != 0) _mint(_feeCollector, protocolShares);
        if (managerShares != 0) _mint(_feeRecipient, managerShares);
        emit FeesAccrued(feeShares, managerShares, protocolShares);
    }

    function _splitFeeShares(uint256 feeShares)
        private
        returns (uint256 managerShares, uint256 protocolShares)
    {
        uint16 effectiveShareBps = effectiveProtocolFeeShareBps();
        protocolShares = Math.mulDiv(feeShares, effectiveShareBps, BPS);
        uint256 splitRemainder =
            mulmod(feeShares, effectiveShareBps, BPS) + _protocolFeeSplitRemainderBps;
        if (splitRemainder >= BPS) {
            protocolShares += 1;
            splitRemainder -= BPS;
        }
        // `splitRemainder` is reduced below BPS, which is below uint16.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        _protocolFeeSplitRemainderBps = uint16(splitRemainder);
        managerShares = feeShares - protocolShares;
    }

    function _escrowChallengeFees(uint256 elapsed) private returns (uint256 feeShares) {
        if (_totalSupply == 0 || _creatorFeeBpsPerYear == 0 || elapsed == 0) return 0;
        (feeShares, _challengeFeeAccrualRemainderWad) = _portfolioCalculator.feeSharesAfterElapsed(
            _totalSupply, _challengeFeeAccrualRemainderWad, _creatorFeeBpsPerYear, elapsed
        );
        if (feeShares != 0) {
            _mint(address(this), feeShares);
            _escrowedManagerFeeShares += feeShares;
        }
        emit ManagerFeesEscrowed(feeShares, _escrowedManagerFeeShares);
    }

    function _releaseChallengeFees() private returns (uint256 feeShares) {
        feeShares = _escrowedManagerFeeShares;
        uint256 combinedRemainder = _feeAccrualRemainderWad + _challengeFeeAccrualRemainderWad;
        if (combinedRemainder >= 1e18) {
            combinedRemainder -= 1e18;
            feeShares++;
            _mint(address(this), 1);
        }
        _feeAccrualRemainderWad = combinedRemainder;
        _challengeFeeAccrualRemainderWad = 0;
        _escrowedManagerFeeShares = 0;

        (uint256 managerShares, uint256 protocolShares) = _splitFeeShares(feeShares);
        if (protocolShares != 0) _transfer(address(this), _feeCollector, protocolShares);
        if (managerShares != 0) _transfer(address(this), _feeRecipient, managerShares);
        emit FeesAccrued(feeShares, managerShares, protocolShares);
        emit ManagerFeesReleased(_feeRecipient, managerShares);
    }

    function _forfeitChallengeFees() internal {
        // All accrual paths converge here. Keep the transition idempotent so no caller can
        // process the same challenge more than once, even if a future entry point omits a guard.
        if (_lastFeeAccrualTimestamp == _challengeDeadline) return;

        uint64 deadline = _challengeDeadline;
        uint256 forfeitedShares = _escrowedManagerFeeShares;
        uint256 rewardShares = Math.mulDiv(forfeitedShares, CHALLENGE_CALLER_REWARD_BPS, BPS);
        address caller = _challengeCaller;
        if (rewardShares != 0 && caller != address(0)) {
            _challengeRewardShares[caller] += rewardShares;
        }
        uint256 treasuryShares = forfeitedShares - rewardShares;
        if (treasuryShares != 0) _transfer(address(this), _feeCollector, treasuryShares);
        _escrowedManagerFeeShares = 0;
        _challengeFeeAccrualRemainderWad = 0;
        _forfeitedManagerFeeShares += forfeitedShares;
        _lastFeeAccrualTimestamp = deadline;
        emit ChallengeDeadlineMissed(deadline, uint64(block.timestamp));
        emit ManagerFeesForfeited(forfeitedShares);
        emit ChallengeRewardAccrued(caller, rewardShares, forfeitedShares);
    }

    // Validation and calculations

    function _validateInitialPortfolio(address[] calldata assets_, uint16[] calldata weights_)
        internal
        view
    {
        if (assets_.length == 0) revert EmptyPortfolio();
        if (assets_.length > MAX_TRACKED_ASSETS) revert TrackedAssetLimitExceeded();
        if (assets_.length != weights_.length) {
            revert LengthMismatch(assets_.length, weights_.length);
        }
        uint256 minimumTargetWeightBps = _protocolMinTargetWeightBps();
        uint256 sum;
        for (uint256 i = 0; i < assets_.length; i++) {
            _validateAssetAndWeight(assets_, i, weights_[i], minimumTargetWeightBps);
            sum += weights_[i];
        }
        if (sum != BPS) revert InvalidWeights(sum);
    }

    function _validateAssetAndWeight(
        address[] calldata assets_,
        uint256 index,
        uint256 weight,
        uint256 minimumTargetWeightBps
    ) internal view {
        address asset = assets_[index];
        if (asset == address(0)) revert ZeroAddress();
        if (asset == address(this)) revert SelfAssetNotSupported();
        if (asset.code.length == 0) revert AssetNotContract(asset);
        if (weight < minimumTargetWeightBps) {
            revert AssetWeightTooLow(asset, weight, minimumTargetWeightBps);
        }
        _portfolioCalculator.validateAssetForVault(address(this), asset);
        for (uint256 j = index + 1; j < assets_.length; j++) {
            if (assets_[j] == asset) revert DuplicateConstituent(asset);
        }
    }

    function _validateInitialBalances(address[] calldata assets_, uint256[] calldata amounts)
        internal
        view
    {
        if (assets_.length != amounts.length) {
            revert LengthMismatch(assets_.length, amounts.length);
        }
        for (uint256 i = 0; i < assets_.length; i++) {
            if (amounts[i] == 0) revert InitialAmountZero(assets_[i]);
            uint256 balance = IERC20(assets_[i]).balanceOf(address(this));
            if (balance < amounts[i]) {
                revert InitialBalanceMismatch(assets_[i], amounts[i], balance);
            }
        }
    }

    function _requireDepositsOpen() internal view {
        if (_sunset) revert VaultSunset();
        if (_assets.length == 0) revert EmptyPortfolio();
        if (IProtocolPortfolioLimits(_factory).depositsPaused()) {
            revert ProtocolDepositsPaused();
        }
        if (IProtocolPortfolioLimits(_factory).vaultDepositsPaused(address(this))) {
            revert VaultDepositsPaused();
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (_targetWeightBps[asset] == 0) revert DepositsPausedForRetiringAsset(asset);
        }
    }

    // Storage and transfer helpers

    function _storeInitialPortfolio(address[] calldata assets_, uint16[] calldata weights_)
        internal
    {
        for (uint256 i = 0; i < assets_.length; i++) {
            _assets.push(assets_[i]);
            _targetWeightBps[assets_[i]] = weights_[i];
        }
    }

    function _configureInitialPricing(
        address[] calldata assets_,
        AssetPricingConfig[] calldata pricingConfigs_
    ) internal {
        if (pricingConfigs_.length != assets_.length) {
            revert LengthMismatch(assets_.length, pricingConfigs_.length);
        }
        for (uint256 i = 0; i < assets_.length; i++) {
            _pinAssetPricing(assets_[i], pricingConfigs_[i]);
        }
    }

    function _pinAssetPricing(address asset, AssetPricingConfig calldata config) internal {
        if (_pricingConfiguredForAsset[asset]) {
            if (config.primarySource == address(0)) return;
            if (
                _pricingSourceForAsset[asset] != uint8(config.source)
                    || _quoteTokenForAsset[asset] != config.quoteToken
                    || _primaryPriceSourceForAsset[asset] != config.primarySource
                    || _primaryMaxStalenessForAsset[asset] != config.primaryMaxStaleness
            ) revert AssetPricingAlreadyPinned(asset);
            return;
        }

        (address normalizedFeed, bytes32 marketId, uint32 primaryStaleness) =
            _pricingResolver().resolvePricing(asset, config);

        _pricingSourceForAsset[asset] = uint8(config.source);
        _quoteTokenForAsset[asset] = config.quoteToken;
        _primaryPriceSourceForAsset[asset] = config.primarySource;
        _priceFeedForAsset[asset] = normalizedFeed;
        _marketIdForAsset[asset] = marketId;
        _maxStalenessForAsset[asset] = primaryStaleness;
        _primaryMaxStalenessForAsset[asset] = primaryStaleness;
        _pricingConfiguredForAsset[asset] = true;

        _portfolioCalculator.validateAssetForVault(address(this), asset);
        emit AssetPricingPinned(
            asset, config.source, normalizedFeed, config.quoteToken, config.primarySource, marketId
        );
    }

    function _pricingResolver() internal view returns (IAssetPricingResolver resolver) {
        address resolverAddress = IProtocolPortfolioLimits(_factory).pricingResolver();
        if (resolverAddress == address(0)) revert PricingResolverNotConfigured();
        resolver = IAssetPricingResolver(resolverAddress);
    }

    /// @dev Strategy module callback. It validates pending sources without mutating vault pricing.
    function modulePrepareAssetPricing(address asset, AssetPricingConfig calldata config) external {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        _pricingResolver().validatePricing(asset, config);
    }

    /// @dev Strategy module callback. Activation pins the source atomically with strategy state.
    function modulePinAssetPricing(address asset, AssetPricingConfig calldata config) external {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        _pinAssetPricing(asset, config);
    }

    /// @dev Strategy module callback. Fully pruned assets release every vault-specific pricing slot.
    function moduleClearAssetPricing(address asset) external {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        delete _marketIdForAsset[asset];
        delete _priceFeedForAsset[asset];
        delete _pricingSourceForAsset[asset];
        delete _quoteTokenForAsset[asset];
        delete _primaryPriceSourceForAsset[asset];
        delete _maxStalenessForAsset[asset];
        delete _primaryMaxStalenessForAsset[asset];
        delete _pricingConfiguredForAsset[asset];
    }

    function _pullExact(address asset, address from, uint256 amount) internal {
        if (amount == 0) return;
        uint256 senderBefore = IERC20(asset).balanceOf(from);
        uint256 receiverBefore = IERC20(asset).balanceOf(address(this));
        asset.safeTransferFrom(from, address(this), amount);
        uint256 senderAfter = IERC20(asset).balanceOf(from);
        uint256 receiverAfter = IERC20(asset).balanceOf(address(this));
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert AssetTransferMismatch(asset, amount, senderDelta, receiverDelta);
        }
    }

    function _pushExact(address asset, address receiver, uint256 amount) internal {
        if (amount == 0) return;
        uint256 senderBefore = IERC20(asset).balanceOf(address(this));
        uint256 receiverBefore = IERC20(asset).balanceOf(receiver);
        asset.safeTransfer(receiver, amount);
        uint256 senderAfter = IERC20(asset).balanceOf(address(this));
        uint256 receiverAfter = IERC20(asset).balanceOf(receiver);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert AssetTransferMismatch(asset, amount, senderDelta, receiverDelta);
        }
    }

    function _weightsAsUint256() internal view returns (uint256[] memory weights) {
        weights = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = _targetWeightBps[_assets[i]];
        }
    }

    function _delegateStrategy() private {
        if (!_initialized) revert NotInitialized();
        address module = _strategyModule;
        bytes32 actualCodehash = module.codehash;
        if (actualCodehash != _strategyModuleCodehash) {
            revert StrategyModuleIntegrityCheckFailed(_strategyModuleCodehash, actualCodehash);
        }
        assembly {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    function _delegateView() private {
        if (!_initialized) revert NotInitialized();
        address module = _viewModule;
        bytes32 actualCodehash = module.codehash;
        if (actualCodehash != _viewModuleCodehash) {
            revert StrategyModuleIntegrityCheckFailed(_viewModuleCodehash, actualCodehash);
        }
        assembly {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}




