// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "./ERC20Base.sol";
import { IAssetRegistry } from "./interfaces/IAssetRegistry.sol";
import { IERC20, IERC20Metadata } from "./interfaces/IERC20.sol";
import { IOracleRegistry } from "./interfaces/IOracleRegistry.sol";
import { IPriceFeed } from "./interfaces/IPriceFeed.sol";
import { IAdapterAllowlist } from "./interfaces/IAdapterAllowlist.sol";
import { RebalanceExecutor } from "./RebalanceExecutor.sol";
import { MathEx } from "./libraries/MathEx.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { RebalanceRecord, ThesisVersion, TradeInstruction, VaultInitParams } from "./VaultTypes.sol";

contract ManagedOTFVault is ERC20Base {
    using MathEx for uint256;
    using SafeTransferLib for address;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MIN_REBALANCE_COOLDOWN = 7 days;
    uint256 public constant MAX_THESIS_BYTES = 2_048;
    uint256 public constant MAX_RATIONALE_BYTES = 1_024;
    uint256 public constant MAX_TRADE_COUNT = 20;
    uint256 private constant RECENT_REBALANCE_CAP = 16;

    error AlreadyInitialized();
    error UnauthorizedFactory();
    error RebalanceCooldownTooShort();
    error RebalanceCooldownActive(uint256 nextAllowedTime);
    error NotManager();
    error NotPendingManager();
    error NotPendingFeeRecipient();
    error ZeroAddress();
    error InvalidArrayLength();
    error EmptyPortfolio();
    error TooManyAssets(uint256 count, uint256 maximum);
    error InitialShareSupplyZero();
    error InitialAmountZero(address asset);
    error InitialBalanceMismatch(address asset, uint256 expected, uint256 actual);
    error AssetNotContract(address asset);
    error UnapprovedAsset(address asset);
    error DuplicateAsset(address asset);
    error InvalidWeightSum(uint256 sum);
    error AssetWeightTooHigh(address asset, uint16 weightBps, uint16 maximum);
    error AssetWeightTooLow(address asset, uint16 weightBps, uint16 minimum);
    error ThesisTooLong(uint256 length);
    error RationaleTooLong(uint256 length);
    error Reentrancy();
    error RebalanceInProgress();
    error ZeroShares();
    error AmountTooHigh(address asset, uint256 required, uint256 maximum);
    error AmountTooLow(address asset, uint256 actual, uint256 minimum);
    error OracleFeedMissing(address asset);
    error InvalidOraclePrice(address asset, int256 answer);
    error InvalidOracleTimestamp(address asset, uint256 updatedAt);
    error IncompleteOracleRound(address asset, uint80 roundId, uint80 answeredInRound);
    error StaleOraclePrice(address asset, uint256 updatedAt, uint256 maxStaleness);
    error TokenDecimalsUnavailable(address token);
    error UnsupportedDecimals(address token, uint8 decimals_);
    error ZeroNav();
    error TurnoverTooHigh(uint16 turnoverBps, uint16 maximum);
    error NavLossTooHigh(uint256 navBefore, uint256 navAfter, uint16 maximumLossBps);
    error TargetDeviationTooHigh(address asset, uint256 actualBps, uint256 targetBps, uint16 maximum);
    error RemovedAssetBalanceRemaining(address asset, uint256 balance);
    error TooManyTrades(uint256 count, uint256 maximum);
    error BadTrade(address tokenIn, address tokenOut, uint256 amountIn);
    error TradeAssetNotTracked(address token);
    error TradeOutputNotInTarget(address token);
    error UnapprovedAdapter(address adapter);
    error InvalidRecordIndex(uint256 index);
    error FeeElapsedTooLong();

    event VaultInitialized(
        address indexed factory,
        address indexed manager,
        address indexed feeRecipient,
        uint32 rebalanceCooldown
    );
    event FeesAccrued(uint256 feeShares, uint256 creatorShares, uint256 protocolShares);
    event ThesisAmended(
        uint256 indexed version,
        uint64 timestamp,
        address indexed author,
        bytes32 indexed portfolioHash,
        string text
    );
    event ManagerTransferStarted(address indexed currentManager, address indexed pendingManager);
    event ManagerTransferred(address indexed oldManager, address indexed newManager);
    event FeeRecipientTransferStarted(address indexed currentRecipient, address indexed pendingRecipient);
    event FeeRecipientTransferred(address indexed oldRecipient, address indexed newRecipient);
    event Rebalanced(
        uint256 indexed rebalanceId,
        address indexed manager,
        RebalanceRecord record,
        address[] targetAssets,
        uint16[] targetWeightsBps,
        string rationale
    );

    bool private _initialized;
    uint256 private _entered;
    bool private _rebalancing;

    struct PendingRebalance {
        bytes32 oldPortfolioHash;
        bytes32 newPortfolioHash;
        uint256 navBefore;
        uint256 navAfter;
        uint16 turnoverBps;
    }

    address public factory;
    address public manager;
    address public pendingManager;
    address public feeRecipient;
    address public pendingFeeRecipient;
    address public feeCollector;
    address public assetRegistry;
    address public oracleRegistry;
    address public rebalanceExecutor;

    uint16 public creatorFeeBpsPerYear;
    uint16 public protocolFeeShareBps;
    uint16 public maxTurnoverBps;
    uint16 public maxNavLossBps;
    uint16 public maxWeightDeviationBps;
    uint16 public maxSingleAssetWeightBps;
    uint16 public minNonZeroAssetWeightBps;
    uint8 public maxAssetCount;
    uint32 public maxOracleStaleness;
    uint32 public rebalanceCooldown;
    uint64 public lastRebalanceTimestamp;
    uint64 public lastFeeAccrualTimestamp;

    uint256 public rebalanceCount;
    mapping(address => uint16) public targetWeightBps;

    address[] private _assets;
    ThesisVersion[] private _thesisVersions;
    RebalanceRecord[16] private _recentRebalances;

    constructor() {
        _initialized = true;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    function initialize(
        VaultInitParams calldata params,
        address factory_,
        address assetRegistry_,
        address oracleRegistry_,
        address rebalanceExecutor_,
        address feeCollector_,
        uint16 protocolFeeShareBps_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != factory_ || factory_ == address(0)) revert UnauthorizedFactory();
        if (
            params.manager == address(0) || params.feeRecipient == address(0)
                || assetRegistry_ == address(0) || oracleRegistry_ == address(0)
                || rebalanceExecutor_ == address(0) || feeCollector_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (params.initialShareSupply == 0) revert InitialShareSupplyZero();
        if (params.rebalanceCooldown < MIN_REBALANCE_COOLDOWN) revert RebalanceCooldownTooShort();
        _validateTextLength(params.initialThesis, MAX_THESIS_BYTES, true);

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
        maxSingleAssetWeightBps = params.maxSingleAssetWeightBps;
        minNonZeroAssetWeightBps = params.minNonZeroAssetWeightBps;
        maxAssetCount = params.maxAssetCount;
        maxOracleStaleness = params.maxOracleStaleness;

        _validatePortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _storePortfolio(params.initialAssets, params.initialTargetWeightsBps);
        _validateInitialBalances(params.initialAssets, params.initialAmounts);

        uint64 timestamp = uint64(block.timestamp);
        lastRebalanceTimestamp = timestamp;
        lastFeeAccrualTimestamp = timestamp;

        _thesisVersions.push(
            ThesisVersion({
                timestamp: timestamp,
                author: params.manager,
                portfolioHash: _portfolioHash(params.initialAssets, params.initialTargetWeightsBps),
                text: params.initialThesis
            })
        );

        _mint(params.manager, params.initialShareSupply);
        emit VaultInitialized(factory_, params.manager, params.feeRecipient, params.rebalanceCooldown);
    }

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
        return block.timestamp >= nextRebalanceTime();
    }

    function totalAssetsValue() public view returns (uint256 nav) {
        for (uint256 i = 0; i < _assets.length; i++) {
            nav += _assetValue(_assets[i], IERC20(_assets[i]).balanceOf(address(this)));
        }
    }

    function navPerShare() external view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) revert ZeroNav();
        return MathEx.mulDiv(totalAssetsValue(), 1e18, supply);
    }

    function currentWeightsBps() public view returns (uint16[] memory weights) {
        uint256 nav = totalAssetsValue();
        if (nav == 0) revert ZeroNav();

        weights = new uint16[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 value = _assetValue(_assets[i], IERC20(_assets[i]).balanceOf(address(this)));
            weights[i] = uint16(MathEx.mulDiv(value, BPS, nav));
        }
    }

    function previewMint(uint256 shares) public view returns (uint256[] memory amountsIn) {
        if (shares == 0) revert ZeroShares();
        uint256 supply = totalSupply;
        amountsIn = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 balance = IERC20(_assets[i]).balanceOf(address(this));
            amountsIn[i] = MathEx.mulDivUp(shares, balance, supply);
        }
    }

    function previewRedeem(uint256 shares) public view returns (uint256[] memory amountsOut) {
        if (shares == 0) revert ZeroShares();
        uint256 supply = totalSupply;
        amountsOut = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 balance = IERC20(_assets[i]).balanceOf(address(this));
            amountsOut[i] = MathEx.mulDiv(shares, balance, supply);
        }
    }

    function recentRebalanceCount() external view returns (uint256) {
        return rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
    }

    function recentRebalanceRecord(uint256 index) external view returns (RebalanceRecord memory) {
        uint256 storedCount = rebalanceCount < RECENT_REBALANCE_CAP ? rebalanceCount : RECENT_REBALANCE_CAP;
        if (index >= storedCount) revert InvalidRecordIndex(index);
        uint256 first = rebalanceCount > RECENT_REBALANCE_CAP ? rebalanceCount - RECENT_REBALANCE_CAP : 0;
        return _recentRebalances[(first + index) % RECENT_REBALANCE_CAP];
    }

    function accrueFees() public nonReentrant returns (uint256 feeShares) {
        feeShares = _accrueFees();
    }

    function mintWithBasket(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        nonReentrant
        returns (uint256[] memory amountsIn)
    {
        if (_rebalancing) revert RebalanceInProgress();
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroShares();
        if (maxAmountsIn.length != _assets.length) revert InvalidArrayLength();

        _accrueFees();
        uint256 supply = totalSupply;
        amountsIn = new uint256[](_assets.length);

        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 required = MathEx.mulDivUp(shares, IERC20(asset).balanceOf(address(this)), supply);
            if (required > maxAmountsIn[i]) revert AmountTooHigh(asset, required, maxAmountsIn[i]);
            amountsIn[i] = required;
            asset.safeTransferFrom(msg.sender, address(this), required);
        }

        _mint(receiver, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256[] calldata minAmountsOut
    ) external nonReentrant returns (uint256[] memory amountsOut) {
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroShares();
        if (minAmountsOut.length != _assets.length) revert InvalidArrayLength();

        _accrueFees();
        uint256 supply = totalSupply;
        amountsOut = new uint256[](_assets.length);

        if (owner != msg.sender) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);

        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 amount = MathEx.mulDiv(shares, IERC20(asset).balanceOf(address(this)), supply);
            if (amount < minAmountsOut[i]) revert AmountTooLow(asset, amount, minAmountsOut[i]);
            amountsOut[i] = amount;
            asset.safeTransfer(receiver, amount);
        }
    }

    function appendThesisAmendment(string calldata text) external onlyManager {
        _validateTextLength(text, MAX_THESIS_BYTES, true);
        uint256 version = _thesisVersions.length;
        uint64 timestamp = uint64(block.timestamp);
        bytes32 portfolioHash = _currentPortfolioHash();

        _thesisVersions.push(
            ThesisVersion({
                timestamp: timestamp,
                author: msg.sender,
                portfolioHash: portfolioHash,
                text: text
            })
        );

        emit ThesisAmended(version, timestamp, msg.sender, portfolioHash, text);
    }

    function beginManagerTransfer(address newManager) external onlyManager {
        if (newManager == address(0)) revert ZeroAddress();
        _accrueFees();
        pendingManager = newManager;
        emit ManagerTransferStarted(manager, newManager);
    }

    function acceptManagerTransfer() external {
        if (msg.sender != pendingManager) revert NotPendingManager();
        _accrueFees();
        address oldManager = manager;
        manager = msg.sender;
        pendingManager = address(0);
        emit ManagerTransferred(oldManager, msg.sender);
    }

    function beginFeeRecipientTransfer(address newFeeRecipient) external onlyManager {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        _accrueFees();
        pendingFeeRecipient = newFeeRecipient;
        emit FeeRecipientTransferStarted(feeRecipient, newFeeRecipient);
    }

    function acceptFeeRecipientTransfer() external {
        if (msg.sender != pendingFeeRecipient) revert NotPendingFeeRecipient();
        _accrueFees();
        address oldRecipient = feeRecipient;
        feeRecipient = msg.sender;
        pendingFeeRecipient = address(0);
        emit FeeRecipientTransferred(oldRecipient, msg.sender);
    }

    function rebalance(
        address[] calldata targetAssets,
        uint16[] calldata targetWeights,
        TradeInstruction[] calldata trades,
        string calldata rationale
    ) external onlyManager nonReentrant {
        uint256 nextAllowedTime = nextRebalanceTime();
        if (block.timestamp < nextAllowedTime) {
            revert RebalanceCooldownActive(nextAllowedTime);
        }
        PendingRebalance memory pending =
            _prepareRebalance(targetAssets, targetWeights, trades, rationale);

        _rebalancing = true;
        _executeTrades(trades);

        _verifyRemovedAssetsCleared(targetAssets);

        pending.navAfter = _portfolioValue(targetAssets);
        _verifyNavLoss(pending.navBefore, pending.navAfter);
        _verifyFinalWeights(targetAssets, targetWeights, pending.navAfter);

        _replacePortfolio(targetAssets, targetWeights);
        _recordSuccessfulRebalance(targetAssets, targetWeights, rationale, pending);
        _rebalancing = false;
    }

    function _prepareRebalance(
        address[] calldata targetAssets,
        uint16[] calldata targetWeights,
        TradeInstruction[] calldata trades,
        string calldata rationale
    ) internal returns (PendingRebalance memory pending) {
        _validateTextLength(rationale, MAX_RATIONALE_BYTES, false);
        _validatePortfolio(targetAssets, targetWeights);
        _validateTrades(targetAssets, trades);

        _accrueFees();

        pending.oldPortfolioHash = _currentPortfolioHash();
        pending.newPortfolioHash = _portfolioHash(targetAssets, targetWeights);
        pending.navBefore = totalAssetsValue();
        if (pending.navBefore == 0) revert ZeroNav();

        pending.turnoverBps = _turnoverBps(targetAssets, targetWeights, pending.navBefore);
        if (pending.turnoverBps > maxTurnoverBps) {
            revert TurnoverTooHigh(pending.turnoverBps, maxTurnoverBps);
        }
    }

    function _executeTrades(TradeInstruction[] calldata trades) internal {
        for (uint256 i = 0; i < trades.length; i++) {
            TradeInstruction calldata trade = trades[i];
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);
            trade.tokenIn.safeApprove(rebalanceExecutor, trade.amountIn);
            RebalanceExecutor(rebalanceExecutor).executeTrade(trade);
            trade.tokenIn.safeApprove(rebalanceExecutor, 0);
        }
    }

    function _recordSuccessfulRebalance(
        address[] calldata targetAssets,
        uint16[] calldata targetWeights,
        string calldata rationale,
        PendingRebalance memory pending
    ) internal {
        uint64 timestamp = uint64(block.timestamp);
        lastRebalanceTimestamp = timestamp;
        uint256 rebalanceId = rebalanceCount;
        uint32 thesisVersion = uint32(_thesisVersions.length - 1);
        RebalanceRecord memory record = RebalanceRecord({
            timestamp: timestamp,
            manager: msg.sender,
            oldPortfolioHash: pending.oldPortfolioHash,
            newPortfolioHash: pending.newPortfolioHash,
            navBefore: pending.navBefore,
            navAfter: pending.navAfter,
            turnoverBps: pending.turnoverBps,
            thesisVersion: thesisVersion
        });
        _recentRebalances[rebalanceId % RECENT_REBALANCE_CAP] = record;
        rebalanceCount = rebalanceId + 1;

        emit Rebalanced(rebalanceId, msg.sender, record, targetAssets, targetWeights, rationale);
    }

    function _accrueFees() internal returns (uint256 feeShares) {
        uint64 previousTimestamp = lastFeeAccrualTimestamp;
        uint256 elapsed = block.timestamp - uint256(previousTimestamp);
        if (elapsed == 0) return 0;

        lastFeeAccrualTimestamp = uint64(block.timestamp);

        uint256 supply = totalSupply;
        uint256 feeBps = creatorFeeBpsPerYear;
        if (supply == 0 || feeBps == 0) return 0;

        uint256 feeNumerator = feeBps * elapsed;
        uint256 annualDenominator = BPS * YEAR;
        if (feeNumerator >= annualDenominator) revert FeeElapsedTooLong();
        uint256 feeDenominator = annualDenominator - feeNumerator;

        feeShares = MathEx.mulDiv(supply, feeNumerator, feeDenominator);
        if (feeShares == 0) {
            emit FeesAccrued(0, 0, 0);
            return 0;
        }

        uint256 protocolShares = MathEx.mulDiv(feeShares, protocolFeeShareBps, BPS);
        uint256 creatorShares = feeShares - protocolShares;
        if (protocolShares != 0) _mint(feeCollector, protocolShares);
        if (creatorShares != 0) _mint(feeRecipient, creatorShares);

        emit FeesAccrued(feeShares, creatorShares, protocolShares);
    }

    function _validateTextLength(string calldata text, uint256 maximum, bool thesisText) internal pure {
        uint256 length = bytes(text).length;
        if (length > maximum) {
            if (thesisText) revert ThesisTooLong(length);
            revert RationaleTooLong(length);
        }
    }

    function _validatePortfolio(address[] calldata assets_, uint16[] calldata weights_) internal view {
        if (assets_.length == 0) revert EmptyPortfolio();
        if (assets_.length != weights_.length) revert InvalidArrayLength();
        if (assets_.length > maxAssetCount) revert TooManyAssets(assets_.length, maxAssetCount);

        uint256 sum;
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            uint16 weight = weights_[i];
            if (asset == address(0)) revert ZeroAddress();
            if (asset.code.length == 0) revert AssetNotContract(asset);
            if (!IAssetRegistry(assetRegistry).isApprovedAsset(asset)) revert UnapprovedAsset(asset);
            if (weight > maxSingleAssetWeightBps) {
                revert AssetWeightTooHigh(asset, weight, maxSingleAssetWeightBps);
            }
            if (weight < minNonZeroAssetWeightBps) {
                revert AssetWeightTooLow(asset, weight, minNonZeroAssetWeightBps);
            }
            _supportedTokenDecimals(asset);
            sum += weight;

            for (uint256 j = i + 1; j < assets_.length; j++) {
                if (assets_[j] == asset) revert DuplicateAsset(asset);
            }
        }

        if (sum != BPS) revert InvalidWeightSum(sum);
    }

    function _validateInitialBalances(address[] calldata assets_, uint256[] calldata amounts) internal view {
        if (assets_.length != amounts.length) revert InvalidArrayLength();
        for (uint256 i = 0; i < assets_.length; i++) {
            if (amounts[i] == 0) revert InitialAmountZero(assets_[i]);
            uint256 balance = IERC20(assets_[i]).balanceOf(address(this));
            if (balance != amounts[i]) revert InitialBalanceMismatch(assets_[i], amounts[i], balance);
        }
    }

    function _validateTrades(address[] calldata targetAssets, TradeInstruction[] calldata trades) internal view {
        if (trades.length > MAX_TRADE_COUNT) revert TooManyTrades(trades.length, MAX_TRADE_COUNT);

        for (uint256 i = 0; i < trades.length; i++) {
            TradeInstruction calldata trade = trades[i];
            if (trade.tokenIn == trade.tokenOut || trade.amountIn == 0) {
                revert BadTrade(trade.tokenIn, trade.tokenOut, trade.amountIn);
            }
            if (!IAssetRegistry(assetRegistry).isApprovedAsset(trade.tokenIn)) {
                revert UnapprovedAsset(trade.tokenIn);
            }
            if (!IAssetRegistry(assetRegistry).isApprovedAsset(trade.tokenOut)) {
                revert UnapprovedAsset(trade.tokenOut);
            }
            if (!IAdapterAllowlist(factory).isTradeAdapterApproved(trade.adapter)) {
                revert UnapprovedAdapter(trade.adapter);
            }
            if (!_containsCurrentAsset(trade.tokenIn) && !_containsCalldata(targetAssets, trade.tokenIn)) {
                revert TradeAssetNotTracked(trade.tokenIn);
            }
            if (!_containsCalldata(targetAssets, trade.tokenOut)) {
                revert TradeOutputNotInTarget(trade.tokenOut);
            }
        }
    }

    function _storePortfolio(address[] calldata assets_, uint16[] calldata weights_) internal {
        for (uint256 i = 0; i < assets_.length; i++) {
            _assets.push(assets_[i]);
            targetWeightBps[assets_[i]] = weights_[i];
        }
    }

    function _replacePortfolio(address[] calldata assets_, uint16[] calldata weights_) internal {
        for (uint256 i = 0; i < _assets.length; i++) {
            targetWeightBps[_assets[i]] = 0;
        }
        delete _assets;
        _storePortfolio(assets_, weights_);
    }

    function _verifyRemovedAssetsCleared(address[] calldata targetAssets) internal view {
        for (uint256 i = 0; i < _assets.length; i++) {
            address oldAsset = _assets[i];
            if (!_containsCalldata(targetAssets, oldAsset)) {
                uint256 balance = IERC20(oldAsset).balanceOf(address(this));
                if (balance != 0) revert RemovedAssetBalanceRemaining(oldAsset, balance);
            }
        }
    }

    function _verifyNavLoss(uint256 navBefore, uint256 navAfter) internal view {
        uint256 minimumNav = MathEx.mulDiv(navBefore, BPS - maxNavLossBps, BPS);
        if (navAfter < minimumNav) revert NavLossTooHigh(navBefore, navAfter, maxNavLossBps);
    }

    function _verifyFinalWeights(
        address[] calldata targetAssets,
        uint16[] calldata targetWeights,
        uint256 navAfter
    ) internal view {
        if (navAfter == 0) revert ZeroNav();
        for (uint256 i = 0; i < targetAssets.length; i++) {
            uint256 value = _assetValue(targetAssets[i], IERC20(targetAssets[i]).balanceOf(address(this)));
            uint256 actualBps = MathEx.mulDiv(value, BPS, navAfter);
            uint256 deviation = actualBps.absDiff(targetWeights[i]);
            if (deviation > maxWeightDeviationBps) {
                revert TargetDeviationTooHigh(targetAssets[i], actualBps, targetWeights[i], maxWeightDeviationBps);
            }
        }
    }

    function _turnoverBps(
        address[] calldata targetAssets,
        uint16[] calldata targetWeights,
        uint256 navBefore
    ) internal view returns (uint16) {
        uint256 sumDiff;

        for (uint256 i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint256 value = _assetValue(asset, IERC20(asset).balanceOf(address(this)));
            uint256 currentWeight = MathEx.mulDiv(value, BPS, navBefore);
            uint256 targetWeight = _weightInCalldata(targetAssets, targetWeights, asset);
            sumDiff += currentWeight.absDiff(targetWeight);
        }

        for (uint256 i = 0; i < targetAssets.length; i++) {
            if (!_containsCurrentAsset(targetAssets[i])) {
                sumDiff += targetWeights[i];
            }
        }

        uint256 turnover = (sumDiff + 1) / 2;
        return uint16(turnover);
    }

    function _portfolioValue(address[] calldata assets_) internal view returns (uint256 nav) {
        for (uint256 i = 0; i < assets_.length; i++) {
            nav += _assetValue(assets_[i], IERC20(assets_[i]).balanceOf(address(this)));
        }
    }

    function _assetValue(address asset, uint256 rawBalance) internal view returns (uint256) {
        if (rawBalance == 0) return 0;
        (uint256 price, uint8 priceDecimals) = _validPrice(asset);
        uint8 tokenDecimals = _supportedTokenDecimals(asset);
        uint256 tokenAdjusted = MathEx.mulDiv(rawBalance, price, 10 ** uint256(tokenDecimals));
        return MathEx.mulDiv(tokenAdjusted, 1e18, 10 ** uint256(priceDecimals));
    }

    function _validPrice(address asset) internal view returns (uint256 price, uint8 priceDecimals) {
        address feed = IOracleRegistry(oracleRegistry).priceFeedFor(asset);
        if (feed == address(0)) revert OracleFeedMissing(asset);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IPriceFeed(feed).latestRoundData();
        if (answer <= 0) revert InvalidOraclePrice(asset, answer);
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidOracleTimestamp(asset, updatedAt);
        if (answeredInRound < roundId) revert IncompleteOracleRound(asset, roundId, answeredInRound);
        if (block.timestamp > updatedAt + maxOracleStaleness) {
            revert StaleOraclePrice(asset, updatedAt, maxOracleStaleness);
        }

        priceDecimals = IPriceFeed(feed).decimals();
        if (priceDecimals > 36) revert UnsupportedDecimals(feed, priceDecimals);
        price = uint256(answer);
    }

    function _supportedTokenDecimals(address token) internal view returns (uint8 tokenDecimals) {
        try IERC20Metadata(token).decimals() returns (uint8 decimals_) {
            if (decimals_ > 36) revert UnsupportedDecimals(token, decimals_);
            return decimals_;
        } catch {
            revert TokenDecimalsUnavailable(token);
        }
    }

    function _portfolioHash(address[] calldata assets_, uint16[] calldata weights_)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(assets_, weights_));
    }

    function _currentPortfolioHash() internal view returns (bytes32) {
        uint16[] memory weights = new uint16[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            weights[i] = targetWeightBps[_assets[i]];
        }
        return keccak256(abi.encode(_assets, weights));
    }

    function _weightInCalldata(
        address[] calldata assets_,
        uint16[] calldata weights_,
        address asset
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < assets_.length; i++) {
            if (assets_[i] == asset) return weights_[i];
        }
        return 0;
    }

    function _containsCalldata(address[] calldata assets_, address asset) internal pure returns (bool) {
        for (uint256 i = 0; i < assets_.length; i++) {
            if (assets_[i] == asset) return true;
        }
        return false;
    }

    function _containsCurrentAsset(address asset) internal view returns (bool) {
        for (uint256 i = 0; i < _assets.length; i++) {
            if (_assets[i] == asset) return true;
        }
        return false;
    }
}
