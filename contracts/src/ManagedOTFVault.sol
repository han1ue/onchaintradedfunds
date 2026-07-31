// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ManagedOTFVaultStorage } from "./ManagedOTFVaultStorage.sol";
import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { PortfolioCalculator } from "./PortfolioCalculator.sol";
import { ManagedOTFVaultStrategy } from "./ManagedOTFVaultStrategy.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import {
    RebalanceRecord,
    ThesisVersion,
    TradeInstruction,
    VaultInitParams
} from "./VaultTypes.sol";

contract ManagedOTFVault is ManagedOTFVaultStorage {
    using MathEx for uint256;
    using SafeTransferLib for address;

    PortfolioCalculator private immutable _portfolioCalculator;
    address private immutable _strategyModule;
    bytes32 private immutable _strategyModuleCodehash;

    constructor() {
        _initialized = true;
        _portfolioCalculator = new PortfolioCalculator();
        _strategyModule = address(new ManagedOTFVaultStrategy(_portfolioCalculator));
        _strategyModuleCodehash = _strategyModule.codehash;
    }

    function initialize(
        VaultInitParams calldata params,
        address factory_,
        address assetRegistry_,
        address oracleRegistry_,
        address rebalanceExecutor_,
        address feeCollector_,
        uint16 protocolFeeShareBps_
    ) external nonReentrant {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != factory_ || factory_ == address(0)) revert UnauthorizedFactory();
        if (
            params.manager == address(0) || params.feeRecipient == address(0)
                || assetRegistry_ == address(0) || oracleRegistry_ == address(0)
                || rebalanceExecutor_ == address(0) || feeCollector_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (params.initialShareSupply <= MINIMUM_LIQUIDITY_SHARES) {
            revert InitialShareSupplyTooSmall(
                params.initialShareSupply, MINIMUM_LIQUIDITY_SHARES + 1
            );
        }
        if (params.rebalanceCooldown < MIN_REBALANCE_COOLDOWN) revert RebalanceCooldownTooShort();
        if (params.manager == address(this) || params.feeRecipient == address(this)) {
            revert InvalidRoleAddress(address(this));
        }
        _validateWeightBands(params.maxWeightDeviationBps, params.challengeWeightDeviationBps);
        if (
            params.challengeGracePeriod < MIN_CHALLENGE_GRACE_PERIOD
                || params.challengeGracePeriod > MAX_CHALLENGE_GRACE_PERIOD
        ) {
            revert InvalidChallengeGracePeriod(params.challengeGracePeriod);
        }
        _validateTextLength(params.initialThesis, MAX_THESIS_BYTES);

        _initialized = true;
        _initializeERC20(params.name, params.symbol, 18);

        factory = factory_;
        manager = params.manager;
        feeRecipient = params.feeRecipient;
        assetRegistry = assetRegistry_;
        oracleRegistry = oracleRegistry_;
        rebalanceExecutor = rebalanceExecutor_;
        feeCollector = feeCollector_;
        creatorFeeBpsPerYear = params.creatorFeeBpsPerYear;
        protocolFeeShareBps = protocolFeeShareBps_;
        rebalanceCooldown = params.rebalanceCooldown;
        maxTurnoverBps = params.maxTurnoverBps;
        maxNavLossBps = params.maxNavLossBps;
        maxWeightDeviationBps = params.maxWeightDeviationBps;
        challengeWeightDeviationBps = params.challengeWeightDeviationBps;
        maxSingleAssetWeightBps = params.maxSingleAssetWeightBps;
        minNonZeroAssetWeightBps = params.minNonZeroAssetWeightBps;
        maxAssetCount = params.maxAssetCount;
        maxOracleStaleness = params.maxOracleStaleness;
        challengeGracePeriod = params.challengeGracePeriod;
        _feeState = FeeState.Accruing;

        _validateInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _storeInitialPortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _validateInitialBalances(params.initialAssets, params.initialAmounts);

        uint64 timestamp = uint64(block.timestamp);
        lastRebalanceTimestamp = timestamp;
        lastFeeAccrualTimestamp = timestamp;
        lastCompletedStrategicRebalance = timestamp;

        _thesisVersions.push(
            ThesisVersion({
                timestamp: timestamp,
                author: params.manager,
                portfolioHash: _portfolioHashCurrent(),
                text: params.initialThesis
            })
        );

        _mint(address(this), MINIMUM_LIQUIDITY_SHARES);
        _mint(params.manager, params.initialShareSupply - MINIMUM_LIQUIDITY_SHARES);

        uint256[] memory initialWeights = _weightsAsUint256();
        emit OwnershipTransferred(address(0), params.manager);
        emit Rebalanced(params.initialAssets, initialWeights);
        emit VaultInitialized(
            factory_, params.manager, params.feeRecipient, params.rebalanceCooldown
        );
    }

    // ERC-165 / ERC-173

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC173_INTERFACE_ID
            || interfaceId == ERC7621_INTERFACE_ID;
    }

    function owner() external view returns (address) {
        return manager;
    }

    function transferOwnership(address newOwner) external onlyManager nonReentrant {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == address(this)) revert InvalidRoleAddress(newOwner);
        _accrueFees();
        _transferManager(newOwner);
    }

    // ERC-7621 views

    function getConstituents()
        external
        view
        returns (address[] memory tokens, uint256[] memory weights)
    {
        tokens = _assets;
        weights = _weightsAsUint256();
    }

    function totalConstituents() external view returns (uint256 count) {
        return _assets.length;
    }

    function getReserve(address token) public view returns (uint256 balance) {
        if (!_containsCurrentAsset(token)) return 0;
        return IERC20(token).balanceOf(address(this));
    }

    function getWeight(address token) external view returns (uint256 weight) {
        if (!_containsCurrentAsset(token)) revert NotConstituent(token);
        return targetWeightBps[token];
    }

    function isConstituent(address token) public view returns (bool) {
        return _containsCurrentAsset(token);
    }

    function totalBasketValue() public view returns (uint256 value) {
        return _portfolioCalculator.totalBasketValue(address(this), _assets);
    }

    // Existing compatibility and protocol views

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assetAt(uint256 index) external view returns (address) {
        return _assets[index];
    }

    function targetWeightsBps() external view returns (uint16[] memory weights) {
        weights = new uint16[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
        }
    }

    function thesisVersionCount() external view returns (uint256) {
        return _thesisVersions.length;
    }

    function getThesisVersion(uint256 index) external view returns (ThesisVersion memory) {
        return _thesisVersions[index];
    }

    function currentThesis() external view returns (string memory) {
        return _thesisVersions[_thesisVersions.length - 1].text;
    }

    function nextRebalanceTime() public view returns (uint256) {
        return uint256(lastRebalanceTimestamp) + uint256(rebalanceCooldown);
    }

    function canRebalance() external view returns (bool) {
        return canProposeTargetWeights();
    }

    function totalAssetsValue() public view returns (uint256 nav) {
        return _portfolioValue();
    }

    function navPerShare() external view returns (uint256) {
        uint256 supply = _previewSupplyAfterAccrual();
        if (supply == 0) return 0;
        return MathEx.mulDiv(totalAssetsValue(), 1e18, supply);
    }

    function currentWeightsBps() public view returns (uint16[] memory weights) {
        (uint256[] memory current,) = _currentWeightsAndNav();
        weights = new uint16[](current.length);
        for (uint256 i = 0; i < current.length; i++) {
            weights[i] = uint16(current[i]);
        }
    }

    function currentWeight(address token) public view returns (uint256 weight) {
        if (!_containsCurrentAsset(token)) revert NotConstituent(token);
        uint256 nav = _portfolioValue();
        if (nav == 0) revert ZeroNav();
        return MathEx.mulDiv(_assetValue(token, IERC20(token).balanceOf(address(this))), BPS, nav);
    }

    function getWeightBands(address token)
        external
        view
        returns (
            uint256 challengeLower,
            uint256 challengeUpper,
            uint256 completionLower,
            uint256 completionUpper
        )
    {
        if (!_containsCurrentAsset(token)) {
            revert NotConstituent(token);
        }
        uint256 target = targetWeightBps[token];
        (challengeLower, challengeUpper) = _band(target, challengeWeightDeviationBps);
        (completionLower, completionUpper) = _band(target, maxWeightDeviationBps);
    }

    function isWithinTargetBands() public view returns (bool) {
        return _isWithinBands(maxWeightDeviationBps);
    }

    function isWithinChallengeBands() public view returns (bool) {
        return _isWithinBands(challengeWeightDeviationBps);
    }

    function canProposeTargetWeights() public view returns (bool) {
        // Validator timestamp drift is immaterial to the configured multi-day strategy delay.
        // forge-lint: disable-next-line(block-timestamp)
        bool cooldownActive = block.timestamp < nextRebalanceTime();
        if (
            challengeActive || strategicRebalanceActive || cooldownActive
                || feeState() == FeeState.Suspended
        ) {
            return false;
        }
        return _isWithinBands(maxWeightDeviationBps);
    }

    function challengeTimeRemaining() external view returns (uint256) {
        // Challenge deadlines intentionally use chain time.
        // forge-lint: disable-next-line(block-timestamp)
        if (!challengeActive || block.timestamp >= challengeDeadline) return 0;
        return uint256(challengeDeadline) - block.timestamp;
    }

    function feeState() public view returns (FeeState) {
        // Fee suspension must reflect the onchain challenge deadline.
        // forge-lint: disable-next-line(block-timestamp)
        bool deadlineMissed = block.timestamp > challengeDeadline;
        if (_feeState == FeeState.Escrowed && challengeActive && deadlineMissed) {
            return FeeState.Suspended;
        }
        return _feeState;
    }

    function feesAccruing() external view returns (bool) {
        return feeState() == FeeState.Accruing;
    }

    function feesEscrowed() external view returns (bool) {
        return feeState() == FeeState.Escrowed;
    }

    function feesSuspended() external view returns (bool) {
        return feeState() == FeeState.Suspended;
    }

    function authorizedExecutors() external view returns (address[] memory) {
        return _authorizedExecutors;
    }

    function recentRebalanceCount() external view returns (uint256) {
        return rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
    }

    function recentRebalanceRecord(uint256 index) external view returns (RebalanceRecord memory) {
        uint256 storedCount =
            rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first =
            rebalanceCount > RECENT_REBALANCE_CAP ? rebalanceCount - RECENT_REBALANCE_CAP : 0;
        return _recentRebalances[(first + index) % RECENT_REBALANCE_CAP];
    }

    // ERC-7621 entry and exit

    function previewContribute(uint256[] calldata amounts) public view returns (uint256 lpAmount) {
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
        if (!anyAmount) return 0;

        uint256 supply = _previewSupplyAfterAccrual();
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

    function previewWithdraw(uint256 lpAmount) public view returns (uint256[] memory amounts) {
        amounts = new uint256[](_assets.length);
        if (lpAmount == 0) return amounts;
        uint256 supply = _previewSupplyAfterAccrual();
        for (uint256 i = 0; i < _assets.length; i++) {
            amounts[i] =
                MathEx.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), lpAmount, supply);
        }
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

    function previewMint(uint256 shares) public view returns (uint256[] memory amountsIn) {
        if (shares == 0) revert ZeroShares();
        uint256 supply = _previewSupplyAfterAccrual();
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            amountsIn[i] =
                MathEx.mulDivUp(shares, IERC20(_assets[i]).balanceOf(address(this)), supply);
        }
    }

    function previewRedeem(uint256 shares) public view returns (uint256[] memory amountsOut) {
        if (shares == 0) revert ZeroShares();
        return previewWithdraw(shares);
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

    function accrueFees() public onlyInitialized nonReentrant returns (uint256 feeShares) {
        feeShares = _accrueFees();
    }

    // Strategy authority

    function appendThesisAmendment(string calldata text) external {
        text;
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

    function setExecutor(address executor, bool authorized) external {
        executor;
        authorized;
        _delegateStrategy();
    }

    function beginManagerTransfer(address newManager) external onlyManager nonReentrant {
        if (newManager == address(0)) revert ZeroAddress();
        if (newManager == address(this)) revert InvalidRoleAddress(newManager);
        _accrueFees();
        pendingManager = newManager;
        emit ManagerTransferStarted(manager, newManager);
    }

    function acceptManagerTransfer() external nonReentrant {
        if (msg.sender != pendingManager) revert NotPendingManager();
        _accrueFees();
        _transferManager(msg.sender);
    }

    function beginFeeRecipientTransfer(address newFeeRecipient) external onlyManager nonReentrant {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        if (newFeeRecipient == address(this)) revert InvalidRoleAddress(newFeeRecipient);
        _accrueFees();
        pendingFeeRecipient = newFeeRecipient;
        emit FeeRecipientTransferStarted(feeRecipient, newFeeRecipient);
    }

    function acceptFeeRecipientTransfer() external nonReentrant {
        if (msg.sender != pendingFeeRecipient) revert NotPendingFeeRecipient();
        _accrueFees();
        address oldRecipient = feeRecipient;
        feeRecipient = msg.sender;
        pendingFeeRecipient = address(0);
        emit FeeRecipientTransferred(oldRecipient, msg.sender);
    }

    // ERC-7621 rebalance changes targets only. Trades and completion are separate calls.

    function rebalance(address[] calldata newTokens, uint256[] calldata newWeights) external {
        newTokens;
        newWeights;
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

    function syncChallengeDeadline() external {
        _delegateStrategy();
    }

    function moduleAccrueFees() external returns (uint256) {
        if (msg.sender != address(this)) revert UnauthorizedModuleCallback();
        return _accrueFees();
    }

    function strategyModule() external view returns (address) {
        return _strategyModule;
    }

    function strategyModuleCodehash() external view returns (bytes32) {
        return _strategyModuleCodehash;
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
        uint64 previousTimestamp = lastFeeAccrualTimestamp;
        uint256 elapsed = block.timestamp - uint256(previousTimestamp);
        // Fee forfeiture is intentionally keyed to the onchain challenge deadline.
        // forge-lint: disable-next-line(block-timestamp)
        bool deadlineMissed = block.timestamp > challengeDeadline;
        if (elapsed == 0) {
            if (_feeState == FeeState.Escrowed && challengeActive && deadlineMissed) {
                _forfeitEscrowAndSuspend();
            }
            return 0;
        }

        if (_feeState == FeeState.Suspended) {
            lastFeeAccrualTimestamp = uint64(block.timestamp);
            return 0;
        }

        if (_feeState == FeeState.Escrowed && challengeActive && deadlineMissed) {
            uint256 eligibleElapsed = uint256(challengeDeadline) > previousTimestamp
                ? uint256(challengeDeadline) - uint256(previousTimestamp)
                : 0;
            if (eligibleElapsed != 0) feeShares = _mintFees(eligibleElapsed, true);
            lastFeeAccrualTimestamp = uint64(block.timestamp);
            _forfeitEscrowAndSuspend();
            return feeShares;
        }

        lastFeeAccrualTimestamp = uint64(block.timestamp);
        feeShares = _mintFees(elapsed, _feeState == FeeState.Escrowed);
    }

    function _mintFees(uint256 elapsed, bool escrowManager) internal returns (uint256 feeShares) {
        uint256 supply = totalSupply;
        uint256 feeBps = creatorFeeBpsPerYear;
        if (supply == 0 || feeBps == 0 || elapsed == 0) return 0;
        feeShares = _feeSharesForElapsed(supply, feeBps, elapsed);
        if (feeShares == 0) return 0;

        uint256 protocolShares = MathEx.mulDiv(feeShares, protocolFeeShareBps, BPS);
        uint256 managerShares = feeShares - protocolShares;
        if (protocolShares != 0) _mint(feeCollector, protocolShares);
        if (managerShares != 0) {
            if (escrowManager) {
                _mint(address(this), managerShares);
                escrowedManagerFeeShares += managerShares;
                emit ManagerFeesEscrowed(managerShares, escrowedManagerFeeShares);
            } else {
                _mint(feeRecipient, managerShares);
            }
        }
        emit FeesAccrued(feeShares, managerShares, protocolShares);
    }

    function _feeSharesForElapsed(uint256 supply, uint256 feeBps, uint256 elapsed)
        internal
        pure
        returns (uint256)
    {
        uint256 annualDenominator = BPS * YEAR;
        uint256 accruedSupply = supply;
        uint256 remaining = elapsed;
        while (remaining != 0) {
            uint256 period = remaining > YEAR ? YEAR : remaining;
            uint256 feeNumerator = feeBps * period;
            uint256 feeDenominator = annualDenominator - feeNumerator;
            accruedSupply += MathEx.mulDiv(accruedSupply, feeNumerator, feeDenominator);
            remaining -= period;
        }
        return accruedSupply - supply;
    }

    function _previewSupplyAfterAccrual() internal view returns (uint256 supply) {
        supply = totalSupply;
        uint256 previousTimestamp = lastFeeAccrualTimestamp;
        // Fee previews must use the same chain-time boundary as state-changing accrual.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= previousTimestamp || _feeState == FeeState.Suspended) return supply;

        uint256 end = block.timestamp;
        bool deadlineMissed =
            _feeState == FeeState.Escrowed && challengeActive && end > challengeDeadline;
        if (deadlineMissed) {
            end = challengeDeadline;
            supply -= escrowedManagerFeeShares;
        }
        if (end <= previousTimestamp || creatorFeeBpsPerYear == 0) return supply;

        uint256 feeShares =
            _feeSharesForElapsed(totalSupply, creatorFeeBpsPerYear, end - previousTimestamp);
        if (deadlineMissed) {
            supply += MathEx.mulDiv(feeShares, protocolFeeShareBps, BPS);
        } else {
            supply += feeShares;
        }
    }

    function _forfeitEscrowAndSuspend() internal {
        uint256 amount = escrowedManagerFeeShares;
        escrowedManagerFeeShares = 0;
        if (amount != 0) _burn(address(this), amount);
        _feeState = FeeState.Suspended;
        emit ChallengeDeadlineMissed(challengeDeadline, uint64(block.timestamp));
        emit ManagerFeesForfeited(amount);
        emit ManagerFeeAccrualSuspended(uint64(block.timestamp));
    }

    // Validation and calculations

    function _validateTextLength(string calldata text, uint256 maximum) internal pure {
        uint256 length = bytes(text).length;
        if (length > maximum) revert ThesisTooLong(length);
    }

    function _validateWeightBands(uint16 completionDeviationBps, uint16 challengeDeviationBps_)
        internal
        pure
    {
        if (
            completionDeviationBps == 0 || challengeDeviationBps_ <= completionDeviationBps
                || challengeDeviationBps_ > MAX_BAND_DEVIATION_BPS
        ) {
            revert InvalidWeightBands(completionDeviationBps, challengeDeviationBps_);
        }
    }

    function _validateInitialPortfolio(address[] calldata assets_, uint16[] calldata weights_)
        internal
        view
    {
        if (assets_.length == 0) revert EmptyPortfolio();
        if (assets_.length != weights_.length) {
            revert LengthMismatch(assets_.length, weights_.length);
        }
        if (assets_.length > maxAssetCount) revert TooManyAssets(assets_.length, maxAssetCount);
        uint256 sum;
        for (uint256 i = 0; i < assets_.length; i++) {
            _validateAssetAndWeight(assets_, i, weights_[i]);
            sum += weights_[i];
        }
        if (sum != BPS) revert InvalidWeights(sum);
    }

    function _validateAssetAndWeight(address[] calldata assets_, uint256 index, uint256 weight)
        internal
        view
    {
        address asset = assets_[index];
        if (asset == address(0)) revert ZeroAddress();
        if (asset.code.length == 0) revert AssetNotContract(asset);
        if (!IAssetRegistry(assetRegistry).isApprovedAsset(asset)) revert UnapprovedAsset(asset);
        if (weight > maxSingleAssetWeightBps) {
            revert AssetWeightTooHigh(asset, weight, maxSingleAssetWeightBps);
        }
        if (weight < minNonZeroAssetWeightBps) {
            revert AssetWeightTooLow(asset, weight, minNonZeroAssetWeightBps);
        }
        _portfolioCalculator.validateAsset(asset, oracleRegistry, maxOracleStaleness);
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

    function _currentWeightsAndNav() internal view returns (uint256[] memory weights, uint256 nav) {
        return _portfolioCalculator.portfolioState(
            address(this), _assets, oracleRegistry, maxOracleStaleness
        );
    }

    function _isWithinBands(uint16 deviationBps) internal view returns (bool) {
        return _portfolioCalculator.isWithinBands(
            address(this),
            _assets,
            _weightsAsUint256(),
            oracleRegistry,
            maxOracleStaleness,
            deviationBps
        );
    }

    function _band(uint256 target, uint256 deviation)
        internal
        pure
        returns (uint256 lower, uint256 upper)
    {
        lower = target > deviation ? target - deviation : 0;
        upper = target + deviation > BPS ? BPS : target + deviation;
    }

    function _portfolioValue() internal view returns (uint256 nav) {
        return _portfolioCalculator.portfolioValue(
            address(this), _assets, oracleRegistry, maxOracleStaleness
        );
    }

    function _assetValue(address asset, uint256 rawBalance) internal view returns (uint256) {
        return
            _portfolioCalculator.assetValue(asset, rawBalance, oracleRegistry, maxOracleStaleness);
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

    function _transferManager(address newManager) internal {
        address oldManager = manager;
        _clearExecutors();
        manager = newManager;
        pendingManager = address(0);
        emit OwnershipTransferred(oldManager, newManager);
        emit ManagerTransferred(oldManager, newManager);
    }

    function _clearExecutors() internal {
        for (uint256 i = 0; i < _authorizedExecutors.length; i++) {
            address executor = _authorizedExecutors[i];
            delete authorizedExecutor[executor];
            delete _executorIndexPlusOne[executor];
            emit ExecutorAuthorizationChanged(executor, false);
        }
        delete _authorizedExecutors;
    }

    function _weightsAsUint256() internal view returns (uint256[] memory weights) {
        weights = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
        }
    }

    function _portfolioHashCurrent() internal view returns (bytes32) {
        return keccak256(abi.encode(_assets, _weightsAsUint256()));
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
}
