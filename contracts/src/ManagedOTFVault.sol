// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { ManagedOTFVaultStorage, IOTFFactoryFeePolicy } from "./ManagedOTFVaultStorage.sol";
import { FeeGrowthMath } from "./libraries/FeeGrowthMath.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { VaultInitParams } from "./VaultTypes.sol";

/// @notice Oracleless fixed-basket OTF share token.
/// @dev Formation data and the expense policy are immutable after clone initialization.
contract ManagedOTFVault is ManagedOTFVaultStorage {
    using SafeTransferLib for address;

    constructor() {
        // The implementation itself must never be initialized or used as a vault.
        _initialized = true;
    }

    function initialize(VaultInitParams calldata params) external nonReentrant {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender.code.length == 0) revert UnauthorizedFactory();
        if (
            params.creator == address(0) || params.expenseBeneficiary == address(0)
                || params.entryExitRouter == address(0) || params.feeCollector == address(0)
        ) revert ZeroAddress();
        if (params.creator == address(this) || params.expenseBeneficiary == address(this)) {
            revert InvalidReceiver(address(this));
        }
        if (params.entryExitRouter.code.length == 0) {
            revert InvalidDependency(params.entryExitRouter);
        }
        if (params.feeCollector.code.length == 0) revert InvalidDependency(params.feeCollector);
        uint256 length = params.constituents.length;
        if (length == 0 || length > ProtocolConstants.MAX_CONSTITUENTS) {
            revert InvalidArrayLength(ProtocolConstants.MAX_CONSTITUENTS, length);
        }
        if (params.relativeQuantities.length != length) {
            revert InvalidArrayLength(length, params.relativeQuantities.length);
        }
        if (
            params.annualCreatorExpenseRatioBps
                > ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS
        ) {
            revert ExpenseRatioTooHigh(
                params.annualCreatorExpenseRatioBps,
                ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS
            );
        }
        if (
            params.formationOtfWeightBps > BPS
                || params.formationCalculationVersion
                    != ProtocolConstants.FORMATION_CALCULATION_VERSION
        ) {
            revert InvalidFormationMetadata(
                params.formationOtfWeightBps, params.formationCalculationVersion
            );
        }

        _initialized = true;
        _initializeERC20(params.name, params.symbol, 18);
        _factory = msg.sender;
        _creator = params.creator;
        _expenseBeneficiary = params.expenseBeneficiary;
        _entryExitRouter = params.entryExitRouter;
        _feeCollector = params.feeCollector;
        _annualCreatorExpenseRatioBps = params.annualCreatorExpenseRatioBps;
        _formationOtfWeightBps = params.formationOtfWeightBps;
        _formationSnapshotTime = params.formationSnapshotTime;
        _formationCalculationVersion = params.formationCalculationVersion;
        _formationSnapshotDigest = params.formationSnapshotDigest;

        for (uint256 i = 0; i < length; i++) {
            address asset = params.constituents[i];
            if (asset == address(0) || asset == address(this) || asset.code.length == 0) {
                revert InvalidConstituent(asset);
            }
            if (_relativeQuantity[asset] != 0) revert DuplicateConstituent(asset);
            uint256 quantity = params.relativeQuantities[i];
            if (quantity == 0) revert InvalidRelativeQuantity(asset);
            _assets.push(asset);
            _relativeQuantity[asset] = quantity;
        }

        uint64 timestamp = uint64(block.timestamp);
        _feeEpochTimestamp = timestamp;
        _lastFeeCheckpointTimestamp = timestamp;
        emit VaultInitialized(
            msg.sender, params.creator, params.expenseBeneficiary, params.formationSnapshotDigest
        );
    }

    // Formation and policy views

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function creator() external view returns (address) {
        return _creator;
    }

    function expenseBeneficiary() external view returns (address) {
        return _expenseBeneficiary;
    }

    function feeCollector() external view returns (address) {
        return _feeCollector;
    }

    function entryExitRouter() external view returns (address) {
        return _entryExitRouter;
    }

    function annualCreatorExpenseRatioBps() external view returns (uint16) {
        return _annualCreatorExpenseRatioBps;
    }

    function formationOtfWeightBps() external view returns (uint16) {
        return _formationOtfWeightBps;
    }

    function formationSnapshotTime() external view returns (uint64) {
        return _formationSnapshotTime;
    }

    function formationCalculationVersion() external view returns (uint32) {
        return _formationCalculationVersion;
    }

    function formationSnapshotDigest() external view returns (bytes32) {
        return _formationSnapshotDigest;
    }

    function relativeQuantity(address asset) external view returns (uint256) {
        return _relativeQuantity[asset];
    }

    function accountedBalance(address asset) external view returns (uint256) {
        return _accountedBalance[asset];
    }

    function accountedBalances() external view returns (uint256[] memory balances) {
        uint256 length = _assets.length;
        balances = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            balances[i] = _accountedBalance[_assets[i]];
        }
    }

    function shutdown() external view returns (bool) {
        return _shutdown;
    }

    function shutdownAt() external view returns (uint64) {
        return _shutdownAt;
    }

    function lastFeeCheckpointTimestamp() external view returns (uint64) {
        return _lastFeeCheckpointTimestamp;
    }

    function feeShareRemainderWad() external view returns (uint256) {
        (, uint256 remainderWad) = _feeTargetAt(uint64(block.timestamp));
        return remainderWad;
    }

    function protocolFeeSplitRemainderBps() external view returns (uint16) {
        return _protocolFeeSplitRemainderBps;
    }

    function tokenURI() external view returns (string memory) {
        return IOTFFactoryFeePolicy(_factory).otfTokenURI();
    }

    /// @notice Returns false (rather than crediting donations) if any constituent is under-backed.
    function backingIsSound() external view returns (bool) {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            try IERC20(asset).balanceOf(address(this)) returns (uint256 actual) {
                if (actual < _accountedBalance[asset]) return false;
            } catch {
                return false;
            }
        }
        return true;
    }

    // Expense-ratio accounting

    function pendingExpenseFeeShares() public view returns (uint256 pendingShares) {
        if (_shutdown || _annualCreatorExpenseRatioBps == 0 || _feeEpochSupply == 0) return 0;
        (uint256 targetShares,) = _feeTargetAt(uint64(block.timestamp));
        if (targetShares > _feeEpochAccruedShares) {
            pendingShares = targetShares - _feeEpochAccruedShares;
        }
    }

    function previewExpenseFees()
        external
        view
        returns (
            uint256 totalFeeShares,
            uint256 creatorShares,
            uint256 protocolShares,
            uint16 effectiveProtocolShareBps
        )
    {
        totalFeeShares = pendingExpenseFeeShares();
        effectiveProtocolShareBps =
            IOTFFactoryFeePolicy(_factory).effectiveProtocolFeeShareBps(address(this));
        if (effectiveProtocolShareBps > BPS) effectiveProtocolShareBps = 10_000;
        (creatorShares, protocolShares,) =
            _splitFeeShares(totalFeeShares, effectiveProtocolShareBps);
    }

    function checkpointFees()
        external
        onlyInitialized
        nonReentrant
        returns (uint256 totalFeeShares)
    {
        totalFeeShares = _accrueFees();
    }

    // Router-only normal settlement

    function previewMint(uint256 shares) public view returns (uint256[] memory amountsIn) {
        if (shares == 0) revert ZeroShares();
        uint256 effectiveSupply = _totalSupply + pendingExpenseFeeShares();
        amountsIn = _previewMintWithSupply(shares, effectiveSupply);
    }

    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        view
        returns (uint256 shares, uint256[] memory amountsIn)
    {
        uint256 length = _assets.length;
        if (maxAmountsIn.length != length) {
            revert InvalidArrayLength(length, maxAmountsIn.length);
        }
        uint256 effectiveSupply = _totalSupply + pendingExpenseFeeShares();
        uint256 denominator = effectiveSupply == 0 ? FORMATION_SHARE_UNIT : effectiveSupply;
        shares = type(uint256).max;
        bool anyQuantity;
        for (uint256 i = 0; i < length; i++) {
            uint256 quantity = effectiveSupply == 0
                ? _relativeQuantity[_assets[i]]
                : _accountedBalance[_assets[i]];
            if (quantity == 0) continue;
            anyQuantity = true;
            uint256 assetShares = Math.mulDiv(maxAmountsIn[i], denominator, quantity);
            if (assetShares < shares) shares = assetShares;
        }
        if (!anyQuantity) shares = 0;
        if (effectiveSupply == 0 && shares < FORMATION_SHARE_UNIT) shares = 0;
        if (shares == 0) return (0, new uint256[](length));
        amountsIn = _previewMintWithSupply(shares, effectiveSupply);
    }

    function previewRedeem(uint256 shares) public view returns (uint256[] memory amountsOut) {
        if (shares == 0) revert ZeroShares();
        uint256 effectiveSupply = _totalSupply + pendingExpenseFeeShares();
        amountsOut = _previewRedeemWithSupply(shares, effectiveSupply);
    }

    function routerMint(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        onlyInitialized
        onlyRouter
        nonReentrant
        returns (uint256[] memory amountsIn)
    {
        if (_shutdown) revert VaultShutdown();
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        uint256 length = _assets.length;
        if (maxAmountsIn.length != length) {
            revert InvalidArrayLength(length, maxAmountsIn.length);
        }

        _accrueFees();
        _requireBackingSound();
        uint256[] memory balancesBefore = _actualBalances();
        uint256[] memory senderBalancesBefore = _basketBalances(msg.sender);
        amountsIn = _previewMintWithSupply(shares, _totalSupply);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 amount = amountsIn[i];
            if (amount > maxAmountsIn[i]) revert AmountTooHigh(asset, amount, maxAmountsIn[i]);
            _pullExact(asset, msg.sender, amount);
            _accountedBalance[asset] += amount;
        }
        _requireExpectedBalances(balancesBefore, amountsIn, true);
        _requireExpectedAccountBalances(msg.sender, senderBalancesBefore, amountsIn, false);
        _mint(receiver, shares);
        _resetFeeEpoch();
        emit BasketMinted(msg.sender, receiver, shares, amountsIn);
    }

    function routerRedeem(
        uint256 shares,
        address owner,
        address receiver,
        uint256[] calldata minAmountsOut
    ) external onlyInitialized onlyRouter nonReentrant returns (uint256[] memory amountsOut) {
        if (_shutdown) revert VaultShutdown();
        if (owner == address(0) || receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        uint256 length = _assets.length;
        if (minAmountsOut.length != length) {
            revert InvalidArrayLength(length, minAmountsOut.length);
        }

        _accrueFees();
        _requireBackingSound();
        uint256[] memory balancesBefore = _actualBalances();
        uint256[] memory receiverBalancesBefore = _basketBalances(receiver);
        amountsOut = _previewRedeemWithSupply(shares, _totalSupply);
        for (uint256 i = 0; i < length; i++) {
            if (amountsOut[i] < minAmountsOut[i]) {
                revert AmountTooLow(_assets[i], amountsOut[i], minAmountsOut[i]);
            }
        }
        if (owner != msg.sender) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 amount = amountsOut[i];
            _accountedBalance[asset] -= amount;
            _pushExact(asset, receiver, amount);
        }
        _requireExpectedBalances(balancesBefore, amountsOut, false);
        _requireExpectedAccountBalances(receiver, receiverBalancesBefore, amountsOut, true);
        _resetFeeEpoch();
        emit BasketRedeemed(msg.sender, owner, receiver, shares, amountsOut);
    }

    // Emergency path

    function activateEmergencyShutdown() external onlyInitialized nonReentrant {
        if (_shutdown) revert VaultShutdown();
        if (msg.sender != _creator && !_hasBackingDeficit()) {
            revert UnauthorizedShutdown(msg.sender);
        }
        _accrueFees();
        _shutdown = true;
        _shutdownAt = uint64(block.timestamp);
        emit EmergencyShutdown(msg.sender, _shutdownAt);
    }

    /// @notice Permissionless holder exit using actual balances, safe even after a backing deficit.
    function emergencyRedeem(uint256 shares, address receiver, uint256[] calldata minAmountsOut)
        external
        onlyInitialized
        nonReentrant
        returns (uint256[] memory amountsOut)
    {
        if (!_shutdown) revert VaultNotShutdown();
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        uint256 length = _assets.length;
        if (minAmountsOut.length != length) {
            revert InvalidArrayLength(length, minAmountsOut.length);
        }
        uint256 supply = _totalSupply;
        if (shares > supply) revert SharesExceedSupply(shares, supply);

        amountsOut = new uint256[](length);
        uint256[] memory balancesBefore = new uint256[](length);
        uint256[] memory receiverBalancesBefore = _basketBalances(receiver);
        uint256[] memory accountedReductions = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 actual = IERC20(asset).balanceOf(address(this));
            balancesBefore[i] = actual;
            uint256 accounted = _accountedBalance[asset];
            uint256 distributable = actual < accounted ? actual : accounted;
            amountsOut[i] =
                shares == supply ? distributable : Math.mulDiv(distributable, shares, supply);
            accountedReductions[i] =
                shares == supply ? accounted : Math.mulDiv(accounted, shares, supply);
            if (amountsOut[i] < minAmountsOut[i]) {
                revert AmountTooLow(asset, amountsOut[i], minAmountsOut[i]);
            }
        }

        _burn(msg.sender, shares);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 currentActual = IERC20(asset).balanceOf(address(this));
            if (currentActual != balancesBefore[i]) {
                revert AssetTransferMismatch(
                    asset, balancesBefore[i], balancesBefore[i], currentActual
                );
            }
            _accountedBalance[asset] -= accountedReductions[i];
            _pushExact(asset, receiver, amountsOut[i]);
        }
        _requireExpectedBalances(balancesBefore, amountsOut, false);
        _requireExpectedAccountBalances(receiver, receiverBalancesBefore, amountsOut, true);
        emit EmergencyRedeemed(msg.sender, receiver, shares, amountsOut);
    }

    // Internal accounting

    function _previewMintWithSupply(uint256 shares, uint256 supply)
        internal
        view
        returns (uint256[] memory amountsIn)
    {
        if (supply == 0 && shares < FORMATION_SHARE_UNIT) {
            revert BootstrapSharesTooSmall(shares, FORMATION_SHARE_UNIT);
        }
        uint256 length = _assets.length;
        amountsIn = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            uint256 quantity =
                supply == 0 ? _relativeQuantity[_assets[i]] : _accountedBalance[_assets[i]];
            uint256 denominator = supply == 0 ? FORMATION_SHARE_UNIT : supply;
            amountsIn[i] = Math.mulDiv(quantity, shares, denominator, Math.Rounding.Ceil);
        }
    }

    function _previewRedeemWithSupply(uint256 shares, uint256 supply)
        internal
        view
        returns (uint256[] memory amountsOut)
    {
        if (supply == 0 || shares > supply) revert SharesExceedSupply(shares, supply);
        uint256 length = _assets.length;
        amountsOut = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            uint256 accounted = _accountedBalance[_assets[i]];
            amountsOut[i] = shares == supply ? accounted : Math.mulDiv(accounted, shares, supply);
        }
    }

    function _feeTargetAt(uint64 timestamp)
        internal
        view
        returns (uint256 targetShares, uint256 remainderWad)
    {
        remainderWad = _feeShareRemainderWad;
        if (_shutdown || _annualCreatorExpenseRatioBps == 0 || _feeEpochSupply == 0) {
            return (_feeEpochAccruedShares, remainderWad);
        }
        uint256 elapsed = uint256(timestamp) - uint256(_feeEpochTimestamp);
        if (elapsed == 0) return (_feeEpochAccruedShares, remainderWad);

        if (elapsed == YEAR) {
            uint256 retentionBps = BPS - _annualCreatorExpenseRatioBps;
            targetShares = Math.mulDiv(_feeEpochSupply, _annualCreatorExpenseRatioBps, retentionBps);
            uint256 rationalRemainder =
                mulmod(_feeEpochSupply, _annualCreatorExpenseRatioBps, retentionBps);
            uint256 exactFractional =
                Math.mulDiv(rationalRemainder, WAD, retentionBps) + _feeShareRemainderWad;
            targetShares += exactFractional / WAD;
            remainderWad = exactFractional % WAD;
            return (targetShares, remainderWad);
        }

        uint256 growthWad =
            FeeGrowthMath.expenseDilutionGrowthWad(_annualCreatorExpenseRatioBps, elapsed);
        if (growthWad <= WAD) return (_feeEpochAccruedShares, remainderWad);
        uint256 growthDeltaWad = growthWad - WAD;
        targetShares = Math.mulDiv(_feeEpochSupply, growthDeltaWad, WAD);
        uint256 fractional = mulmod(_feeEpochSupply, growthDeltaWad, WAD) + _feeShareRemainderWad;
        targetShares += fractional / WAD;
        remainderWad = fractional % WAD;
    }

    function _accrueFees() internal returns (uint256 totalFeeShares) {
        _lastFeeCheckpointTimestamp = uint64(block.timestamp);
        if (_shutdown || _annualCreatorExpenseRatioBps == 0 || _feeEpochSupply == 0) return 0;
        (uint256 targetShares,) = _feeTargetAt(uint64(block.timestamp));
        if (targetShares <= _feeEpochAccruedShares) return 0;
        totalFeeShares = targetShares - _feeEpochAccruedShares;
        _feeEpochAccruedShares = targetShares;

        uint16 effectiveProtocolShareBps =
            IOTFFactoryFeePolicy(_factory).effectiveProtocolFeeShareBps(address(this));
        if (effectiveProtocolShareBps > BPS) effectiveProtocolShareBps = 10_000;
        (uint256 creatorShares, uint256 protocolShares, uint16 splitRemainder) =
            _splitFeeShares(totalFeeShares, effectiveProtocolShareBps);
        _protocolFeeSplitRemainderBps = splitRemainder;
        if (creatorShares != 0) _mint(_expenseBeneficiary, creatorShares);
        if (protocolShares != 0) _mint(_feeCollector, protocolShares);
        emit ExpenseFeesCheckpointed(
            totalFeeShares, creatorShares, protocolShares, effectiveProtocolShareBps
        );
    }

    function _splitFeeShares(uint256 feeShares, uint16 protocolShareBps)
        internal
        view
        returns (uint256 creatorShares, uint256 protocolShares, uint16 newRemainderBps)
    {
        protocolShares = Math.mulDiv(feeShares, protocolShareBps, BPS);
        uint256 fractional =
            mulmod(feeShares, protocolShareBps, BPS) + _protocolFeeSplitRemainderBps;
        protocolShares += fractional / BPS;
        // The modulo result is strictly below 10,000 and therefore fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        newRemainderBps = uint16(fractional % BPS);
        creatorShares = feeShares - protocolShares;
    }

    function _resetFeeEpoch() internal {
        (, uint256 remainderWad) = _feeTargetAt(uint64(block.timestamp));
        _feeShareRemainderWad = remainderWad;
        _feeEpochTimestamp = uint64(block.timestamp);
        _feeEpochSupply = _totalSupply;
        _feeEpochAccruedShares = 0;
    }

    function _requireBackingSound() internal view {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 actual = IERC20(asset).balanceOf(address(this));
            uint256 accounted = _accountedBalance[asset];
            if (actual < accounted) revert BackingDeficient(asset, accounted, actual);
        }
    }

    /// @dev A failed balance read does not prove a deficit and cannot authorize shutdown.
    function _hasBackingDeficit() internal view returns (bool) {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            try IERC20(asset).balanceOf(address(this)) returns (uint256 actual) {
                if (actual < _accountedBalance[asset]) return true;
            } catch { }
        }
        return false;
    }

    function _actualBalances() internal view returns (uint256[] memory balances) {
        return _basketBalances(address(this));
    }

    function _basketBalances(address account) internal view returns (uint256[] memory balances) {
        uint256 length = _assets.length;
        balances = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            balances[i] = IERC20(_assets[i]).balanceOf(account);
        }
    }

    function _requireExpectedBalances(
        uint256[] memory balancesBefore,
        uint256[] memory amounts,
        bool increase
    ) internal view {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 expected =
                increase ? balancesBefore[i] + amounts[i] : balancesBefore[i] - amounts[i];
            uint256 actual = IERC20(_assets[i]).balanceOf(address(this));
            if (actual != expected) revert BasketBalanceChanged(_assets[i], expected, actual);
        }
    }

    function _requireExpectedAccountBalances(
        address account,
        uint256[] memory balancesBefore,
        uint256[] memory amounts,
        bool increase
    ) internal view {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 expected =
                increase ? balancesBefore[i] + amounts[i] : balancesBefore[i] - amounts[i];
            uint256 actual = IERC20(_assets[i]).balanceOf(account);
            if (actual != expected) {
                revert BasketAccountBalanceChanged(_assets[i], account, expected, actual);
            }
        }
    }

    function _pullExact(address asset, address from, uint256 amount) internal {
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

    function _pushExact(address asset, address to, uint256 amount) internal {
        uint256 senderBefore = IERC20(asset).balanceOf(address(this));
        uint256 receiverBefore = IERC20(asset).balanceOf(to);
        if (amount != 0) asset.safeTransfer(to, amount);
        uint256 senderAfter = IERC20(asset).balanceOf(address(this));
        uint256 receiverAfter = IERC20(asset).balanceOf(to);
        uint256 senderDelta = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 receiverDelta = receiverAfter >= receiverBefore ? receiverAfter - receiverBefore : 0;
        if (senderDelta != amount || receiverDelta != amount) {
            revert AssetTransferMismatch(asset, amount, senderDelta, receiverDelta);
        }
    }
}
