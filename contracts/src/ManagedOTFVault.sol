// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IProtocolPortfolioLimits,
    IProtocolTokenFeePolicy,
    ManagedOTFVaultStorage
} from "./ManagedOTFVaultStorage.sol";
import { IAssetPricingResolver } from "./AssetPricingResolver.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { OracleValidationMode } from "./interfaces/IOracleTypes.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { MathEx } from "./libraries/MathEx.sol";
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
    using MathEx for uint256;
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
        address primarySource,
        address secondarySource,
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

    function bindFactory(bytes32) external {
        if (_initialized) revert AlreadyInitialized();
        if (factory != address(0)) revert UnauthorizedFactory();
        factory = msg.sender;
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
        if (msg.sender != factory_ || factory_ == address(0) || factory != factory_) {
            revert UnauthorizedFactory();
        }
        // The bound factory is the only initializer and validates roles, dependencies, and all
        // creation-time limits before deploying the clone.
        if (params.manager == address(this) || params.feeRecipient == address(this)) {
            revert InvalidRoleAddress(address(this));
        }
        _initialized = true;
        _initializeERC20(params.name, params.symbol, 18);

        factory = factory_;
        manager = params.manager;
        authorizedExecutor[params.manager] = true;
        _authorizedExecutors.push(params.manager);
        _executorIndexPlusOne[params.manager] = 1;
        feeRecipient = params.feeRecipient;
        assetRegistry = assetRegistry_;
        _assetMarketRegistry = assetMarketRegistry_;
        rebalanceExecutor = rebalanceExecutor_;
        feeCollector = feeCollector_;
        creatorFeeBpsPerYear = params.creatorFeeBpsPerYear;
        protocolFeeShareBps = protocolFeeShareBps_;
        maxNavLossBps = params.maxNavLossBps;
        maxWeightDeviationBps = params.maxWeightDeviationBps;
        challengeWeightDeviationBps = params.challengeWeightDeviationBps;
        _feeState = FeeState.Accruing;

        _configureInitialPricing(params.initialAssets, params.initialPricingConfigs);
        _validateInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _storeInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _validateInitialBalances(params.initialAssets, params.initialAmounts);

        uint64 timestamp = uint64(block.timestamp);
        lastFeeAccrualTimestamp = timestamp;
        lastCompletedStrategyTimestamp = timestamp;

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

        _mint(address(this), MINIMUM_LIQUIDITY_SHARES);
        _mint(params.manager, params.initialShareSupply - MINIMUM_LIQUIDITY_SHARES);

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
        return manager;
    }

    function transferOwnership(address newOwner) external {
        newOwner;
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

    function assets() external view returns (address[] memory) {
        return _assets;
    }

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
            address primarySource,
            address secondarySource,
            address normalizedPriceFeed,
            uint32 primaryMaxStaleness,
            uint32 secondaryMaxStaleness,
            OracleValidationMode primaryValidationMode,
            OracleValidationMode secondaryValidationMode
        )
    {
        asset;
        configured;
        source;
        primarySource;
        secondarySource;
        normalizedPriceFeed;
        primaryMaxStaleness;
        secondaryMaxStaleness;
        primaryValidationMode;
        secondaryValidationMode;
        _delegateView();
    }

    function maxStalenessForAsset(address asset) external returns (uint32 maxStaleness) {
        asset;
        maxStaleness;
        _delegateView();
    }

    function oracleValidationModeForAsset(address asset)
        external
        returns (OracleValidationMode mode)
    {
        asset;
        mode;
        _delegateView();
    }

    function assetCount() external returns (uint256 count) {
        count;
        _delegateView();
    }

    function assetAt(uint256 index) external returns (address asset) {
        index;
        asset;
        _delegateView();
    }

    function pruneRetiredAssets() external returns (uint256 removed) {
        removed;
        _delegateStrategy();
    }

    function targetWeightsBps() external returns (uint16[] memory weights) {
        weights;
        _delegateView();
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

    function feesAccruing() external returns (bool accruing) {
        accruing;
        _delegateView();
    }

    function feesEscrowed() external returns (bool escrowed) {
        escrowed;
        _delegateView();
    }

    function feesSuspended() external returns (bool suspended) {
        suspended;
        _delegateView();
    }

    /// @notice Protocol fee share after the OTF target-weight incentive is applied.
    /// @dev Missing constituents and failed target-weight reads preserve the base fee share.
    function effectiveProtocolFeeShareBps() public view returns (uint16 effectiveShareBps) {
        effectiveShareBps = protocolFeeShareBps;
        try IProtocolTokenFeePolicy(factory)
            .effectiveProtocolFeeShareBps(address(this), effectiveShareBps) returns (
            uint16 configuredShareBps
        ) {
            if (configuredShareBps <= BPS) return configuredShareBps;
        } catch {
            // Legacy factories and failed target-weight reads preserve the base protocol share.
        }
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
        uint256 supply = totalSupply;
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 required =
                MathEx.mulDivUp(shares, IERC20(asset).balanceOf(address(this)), supply);
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

    function accrueFees() public returns (uint256 feeShares) {
        feeShares;
        _delegateStrategy();
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
            if (authorizedExecutor[executor]) revert ExecutorAlreadyAuthorized(executor);
            if (_authorizedExecutors.length >= MAX_AUTHORIZED_EXECUTORS) {
                revert ExecutorLimitReached();
            }
            authorizedExecutor[executor] = true;
            _authorizedExecutors.push(executor);
            _executorIndexPlusOne[executor] = _authorizedExecutors.length;
        } else {
            if (!authorizedExecutor[executor]) revert ExecutorNotAuthorized(executor);
            uint256 index = _executorIndexPlusOne[executor] - 1;
            uint256 lastIndex = _authorizedExecutors.length - 1;
            if (index != lastIndex) {
                address moved = _authorizedExecutors[lastIndex];
                _authorizedExecutors[index] = moved;
                _executorIndexPlusOne[moved] = index + 1;
            }
            _authorizedExecutors.pop();
            delete _executorIndexPlusOne[executor];
            authorizedExecutor[executor] = false;
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

    function stopChallengeFees() external {
        _delegateStrategy();
    }

    function moduleAccrueFees() external returns (uint256) {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        return _accrueFees();
    }

    function moduleMintFees(uint256 elapsed) external returns (uint256) {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        return _mintFees(elapsed);
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
        uint256 supply = totalSupply;
        lpAmount = type(uint256).max;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            if (reserve == 0) {
                if (amounts[i] != 0) {
                    revert NonProportionalContribution(_assets[i], amounts[i], 0);
                }
                continue;
            }
            uint256 candidate = MathEx.mulDiv(amounts[i], supply, reserve);
            if (candidate < lpAmount) lpAmount = candidate;
        }
        if (lpAmount == type(uint256).max) return 0;
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 reserve = IERC20(_assets[i]).balanceOf(address(this));
            uint256 required = MathEx.mulDivUp(lpAmount, reserve, supply);
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
        uint256 supply = totalSupply;
        amounts = new uint256[](_assets.length);
        if (shareOwner != msg.sender) _spendAllowance(shareOwner, msg.sender, shares);
        _burn(shareOwner, shares);

        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 amount = MathEx.mulDiv(shares, IERC20(asset).balanceOf(address(this)), supply);
            if (amount < minimums[i]) {
                revert InsufficientAmount(i, minimums[i], amount);
            }
            amounts[i] = amount;
            _pushExact(asset, receiver, amount);
        }
    }

    // Fee state machine

    function _accrueFees() internal returns (uint256 feeShares) {
        if (sunset) return 0;
        uint64 previousTimestamp = lastFeeAccrualTimestamp;
        uint256 elapsed = block.timestamp - uint256(previousTimestamp);
        if (challengeActive) {
            // Challenge fee checkpoints intentionally use the onchain deadline.
            // forge-lint: disable-next-line(block-timestamp)
            uint256 currentTimestamp = block.timestamp;
            uint256 checkpoint = currentTimestamp < challengeDeadline
                ? currentTimestamp
                : uint256(challengeDeadline);
            if (_feeState != FeeState.Suspended && checkpoint > previousTimestamp) {
                feeShares = _escrowChallengeFees(checkpoint - previousTimestamp);
                // Chain timestamps fit uint64 for the lifetime of the protocol.
                // forge-lint: disable-next-line(unsafe-typecast)
                lastFeeAccrualTimestamp = uint64(checkpoint);
            }
            // Fee forfeiture is intentionally keyed to the onchain challenge deadline.
            if (currentTimestamp > challengeDeadline) _forfeitChallengeFees();
            return feeShares;
        }
        if (elapsed == 0) return 0;

        feeShares = _mintFees(elapsed);
        // Fractional share-wei are retained in vault storage, so even a zero-share checkpoint can
        // safely close the interval. This creates a hard, non-retroactive boundary for deposits,
        // exits, and fee-rate changes.
        lastFeeAccrualTimestamp = uint64(block.timestamp);
    }

    function _mintFees(uint256 elapsed) internal returns (uint256 feeShares) {
        uint256 supply = totalSupply;
        uint16 feeBps = creatorFeeBpsPerYear;
        if (supply == 0 || feeBps == 0 || elapsed == 0) return 0;
        uint256 remainderAfterWad;
        (feeShares, remainderAfterWad) = _portfolioCalculator.feeSharesAfterElapsed(
            supply, _feeAccrualRemainderWad, feeBps, elapsed
        );
        _feeAccrualRemainderWad = remainderAfterWad;
        if (feeShares == 0) return 0;

        (uint256 managerShares, uint256 protocolShares) = _splitFeeShares(feeShares);
        if (protocolShares != 0) _mint(feeCollector, protocolShares);
        if (managerShares != 0) _mint(feeRecipient, managerShares);
        emit FeesAccrued(feeShares, managerShares, protocolShares);
    }

    function _splitFeeShares(uint256 feeShares)
        private
        returns (uint256 managerShares, uint256 protocolShares)
    {
        uint16 effectiveShareBps = effectiveProtocolFeeShareBps();
        protocolShares = MathEx.mulDiv(feeShares, effectiveShareBps, BPS);
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
        if (totalSupply == 0 || creatorFeeBpsPerYear == 0 || elapsed == 0) return 0;
        (feeShares, _challengeFeeAccrualRemainderWad) = _portfolioCalculator.feeSharesAfterElapsed(
            totalSupply, _challengeFeeAccrualRemainderWad, creatorFeeBpsPerYear, elapsed
        );
        if (feeShares != 0) {
            _mint(address(this), feeShares);
            escrowedManagerFeeShares += feeShares;
        }
        emit ManagerFeesEscrowed(feeShares, escrowedManagerFeeShares);
    }

    function _releaseChallengeFees() private returns (uint256 feeShares) {
        feeShares = escrowedManagerFeeShares;
        uint256 combinedRemainder = _feeAccrualRemainderWad + _challengeFeeAccrualRemainderWad;
        if (combinedRemainder >= 1e18) {
            combinedRemainder -= 1e18;
            feeShares++;
            _mint(address(this), 1);
        }
        _feeAccrualRemainderWad = combinedRemainder;
        _challengeFeeAccrualRemainderWad = 0;
        escrowedManagerFeeShares = 0;
        _feeState = FeeState.Accruing;

        (uint256 managerShares, uint256 protocolShares) = _splitFeeShares(feeShares);
        if (protocolShares != 0) _transfer(address(this), feeCollector, protocolShares);
        if (managerShares != 0) _transfer(address(this), feeRecipient, managerShares);
        emit FeesAccrued(feeShares, managerShares, protocolShares);
        emit ManagerFeesReleased(feeRecipient, managerShares);
    }

    function _forfeitChallengeFees() internal {
        // All accrual paths converge here. Keep the transition idempotent so no caller can
        // process the same challenge more than once, even if a future entry point omits a guard.
        if (_feeState == FeeState.Suspended) return;

        uint64 deadline = challengeDeadline;
        uint256 forfeitedShares = escrowedManagerFeeShares;
        uint256 rewardShares = MathEx.mulDiv(forfeitedShares, CHALLENGE_CALLER_REWARD_BPS, BPS);
        address caller = challengeCaller;
        if (rewardShares != 0 && caller != address(0)) {
            challengeRewardShares[caller] += rewardShares;
        }
        uint256 burnedShares = forfeitedShares - rewardShares;
        if (burnedShares != 0) _burn(address(this), burnedShares);
        escrowedManagerFeeShares = 0;
        _challengeFeeAccrualRemainderWad = 0;
        forfeitedManagerFeeShares += forfeitedShares;
        lastFeeAccrualTimestamp = deadline;
        _feeState = FeeState.Suspended;
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
        if (sunset) revert VaultSunset();
        if (_assets.length == 0) revert EmptyPortfolio();
        if (IProtocolPortfolioLimits(factory).depositsPaused()) {
            revert ProtocolDepositsPaused();
        }
        if (IProtocolPortfolioLimits(factory).vaultDepositsPaused(address(this))) {
            revert VaultDepositsPaused();
        }
        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            if (targetWeightBps[asset] == 0) revert DepositsPausedForRetiringAsset(asset);
        }
    }

    // Storage and transfer helpers

    function _storeInitialPortfolio(address[] calldata assets_, uint16[] calldata weights_)
        internal
    {
        for (uint256 i = 0; i < assets_.length; i++) {
            _assets.push(assets_[i]);
            targetWeightBps[assets_[i]] = weights_[i];
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
                    || _primaryPriceSourceForAsset[asset] != config.primarySource
                    || _secondaryPriceSourceForAsset[asset] != config.secondarySource
                    || _primaryMaxStalenessForAsset[asset] != config.primaryMaxStaleness
                    || _secondaryMaxStalenessForAsset[asset] != config.secondaryMaxStaleness
                    || _primaryOracleValidationModeForAsset[asset]
                        != uint8(config.primaryValidationMode)
                    || _secondaryOracleValidationModeForAsset[asset]
                        != uint8(config.secondaryValidationMode)
            ) revert AssetPricingAlreadyPinned(asset);
            return;
        }

        (
            address normalizedFeed,
            bytes32 marketId,
            uint32 primaryStaleness,
            uint32 secondaryStaleness,
            OracleValidationMode primaryMode,
            OracleValidationMode secondaryMode
        ) = _pricingResolver().resolvePricing(asset, config);

        _pricingSourceForAsset[asset] = uint8(config.source);
        _primaryPriceSourceForAsset[asset] = config.primarySource;
        _secondaryPriceSourceForAsset[asset] = config.secondarySource;
        _priceFeedForAsset[asset] = normalizedFeed;
        _marketIdForAsset[asset] = marketId;
        _maxStalenessForAsset[asset] = config.source == PricingSource.ChainlinkAssetWeth
            ? (primaryStaleness > secondaryStaleness ? primaryStaleness : secondaryStaleness)
            : primaryStaleness;
        _oracleValidationModeForAsset[asset] = uint8(
            config.source == PricingSource.ChainlinkDirect
                ? primaryMode
                : OracleValidationMode.StandardChainlink
        );
        _primaryMaxStalenessForAsset[asset] = primaryStaleness;
        _primaryOracleValidationModeForAsset[asset] = uint8(primaryMode);
        _secondaryMaxStalenessForAsset[asset] = secondaryStaleness;
        _secondaryOracleValidationModeForAsset[asset] = uint8(secondaryMode);
        _pricingConfiguredForAsset[asset] = true;

        _portfolioCalculator.validateAssetForVault(address(this), asset);
        emit AssetPricingPinned(
            asset,
            config.source,
            normalizedFeed,
            config.primarySource,
            config.secondarySource,
            marketId
        );
    }

    function _pricingResolver() internal view returns (IAssetPricingResolver resolver) {
        address resolverAddress = IProtocolPortfolioLimits(factory).pricingResolver();
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
            weights[i] = targetWeightBps[_assets[i]];
        }
    }

    function _containsCurrentAsset(address asset) internal view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
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
