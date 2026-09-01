// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { ManagedOTFVaultStorage, IOTFFactoryTokenPolicy } from "./ManagedOTFVaultStorage.sol";
import { FeeGrowthMath } from "./libraries/FeeGrowthMath.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { VaultInitParams } from "./VaultTypes.sol";

/// @notice Oracleless fixed-basket OTF share token.
/// @dev Bootstrap basket units and the expense policy are immutable after clone initialization.
contract ManagedOTFVault is ManagedOTFVaultStorage {
    using SafeTransferLib for address;

    constructor() {
        // The implementation itself must never be initialized or used as a vault.
        _disableInitializers();
    }

    function initialize(VaultInitParams calldata params) external initializer nonReentrant {
        if (msg.sender.code.length == 0) revert UnauthorizedFactory();
        if (
            params.creator == address(0) || params.expenseBeneficiary == address(0)
                || params.entryExitRouter == address(0) || params.buybackCollector == address(0)
                || params.otfToken == address(0)
        ) revert ZeroAddress();
        if (params.creator == address(this) || params.expenseBeneficiary == address(this)) {
            revert InvalidReceiver(address(this));
        }
        if (params.entryExitRouter.code.length == 0) {
            revert InvalidDependency(params.entryExitRouter);
        }
        if (params.buybackCollector.code.length == 0) {
            revert InvalidDependency(params.buybackCollector);
        }
        if (params.otfToken.code.length == 0) revert InvalidDependency(params.otfToken);
        uint256 length = params.constituents.length;
        if (length == 0 || length > ProtocolConstants.MAX_CONSTITUENTS) {
            revert InvalidArrayLength(ProtocolConstants.MAX_CONSTITUENTS, length);
        }
        if (params.bootstrapBasketUnitsPerOTF.length != length) {
            revert InvalidArrayLength(length, params.bootstrapBasketUnitsPerOTF.length);
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
        if (params.mintFeeBps > ProtocolConstants.MAX_MINT_FEE_BPS) {
            revert MintFeeTooHigh(params.mintFeeBps, ProtocolConstants.MAX_MINT_FEE_BPS);
        }
        if (params.redeemFeeBps > ProtocolConstants.MAX_REDEEM_FEE_BPS) {
            revert RedeemFeeTooHigh(params.redeemFeeBps, ProtocolConstants.MAX_REDEEM_FEE_BPS);
        }
        _initialized = true;
        __ERC20_init(params.name, params.symbol);
        _factory = msg.sender;
        _creator = params.creator;
        _expenseBeneficiary = params.expenseBeneficiary;
        _entryExitRouter = params.entryExitRouter;
        _buybackCollector = params.buybackCollector;
        _otfToken = params.otfToken;
        _fundThesis = params.fundThesis;
        _annualCreatorExpenseRatioBps = params.annualCreatorExpenseRatioBps;
        _mintFeeBps = params.mintFeeBps;
        _redeemFeeBps = params.redeemFeeBps;

        for (uint256 i = 0; i < length; i++) {
            address asset = params.constituents[i];
            if (asset == address(0) || asset == address(this) || asset.code.length == 0) {
                revert InvalidConstituent(asset);
            }
            if (_bootstrapBasketUnitsPerOTF[asset] != 0) revert DuplicateConstituent(asset);
            uint256 quantity = params.bootstrapBasketUnitsPerOTF[i];
            if (quantity == 0) revert InvalidBootstrapBasketUnit(asset);
            _assets.push(asset);
            _bootstrapBasketUnitsPerOTF[asset] = quantity;
        }

        uint64 timestamp = uint64(block.timestamp);
        _feeEpochTimestamp = timestamp;
        _lastFeeCheckpointTimestamp = timestamp;
        emit VaultInitialized(msg.sender, params.creator, params.expenseBeneficiary);
    }

    // Bootstrap and policy views

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function creator() external view returns (address) {
        return _creator;
    }

    function fundThesis() external view returns (string memory) {
        return _fundThesis;
    }

    function expenseBeneficiary() external view returns (address) {
        return _expenseBeneficiary;
    }

    function buybackCollector() external view returns (address) {
        return _buybackCollector;
    }

    function entryExitRouter() external view returns (address) {
        return _entryExitRouter;
    }

    function annualCreatorExpenseRatioBps() external view returns (uint16) {
        return _annualCreatorExpenseRatioBps;
    }

    function mintFeeBps() external view returns (uint16) {
        return _mintFeeBps;
    }

    function redeemFeeBps() external view returns (uint16) {
        return _redeemFeeBps;
    }

    function otfToken() external view returns (address) {
        return _otfToken;
    }

    function bootstrapBasketUnitsPerOTF(address asset) external view returns (uint256) {
        return _bootstrapBasketUnitsPerOTF[asset];
    }

    function bootstrapBasketUnits() external view returns (uint256[] memory units) {
        uint256 length = _assets.length;
        units = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            units[i] = _bootstrapBasketUnitsPerOTF[_assets[i]];
        }
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

    function tokenURI() external view returns (string memory) {
        return IOTFFactoryTokenPolicy(_factory).otfTokenURI();
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
            uint256 buybackShares,
            uint16 creatorShareBps
        )
    {
        totalFeeShares = pendingExpenseFeeShares();
        creatorShareBps = feeCreatorShareBps();
        (creatorShares, buybackShares,) = _splitExpenseFeeShares(totalFeeShares, creatorShareBps);
    }

    /// @notice Creator portion of every collected fee, rounded down to whole basis points.
    function feeCreatorShareBps() public view returns (uint16 creatorShareBps) {
        uint256 accountedOtf = _accountedBalance[_otfToken];
        uint256 capped = accountedOtf < ProtocolConstants.OTF_FEE_BENEFIT_CAP
            ? accountedOtf
            : ProtocolConstants.OTF_FEE_BENEFIT_CAP;
        uint256 ratioWad = Math.mulDiv(capped, WAD, ProtocolConstants.OTF_FEE_BENEFIT_CAP);
        uint256 sqrtRatioWad = Math.sqrt(ratioWad * WAD);
        creatorShareBps = uint16(5_000 + Math.mulDiv(4_000, sqrtRatioWad, WAD));
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
        uint256 effectiveSupply = totalSupply() + pendingExpenseFeeShares();
        if (effectiveSupply == 0 && shares < MINIMUM_SHARE_SUPPLY) {
            revert BootstrapSharesTooSmall(shares, MINIMUM_SHARE_SUPPLY);
        }
        amountsIn = _previewMintWithSupply(_grossMintShares(shares), effectiveSupply);
    }

    function previewMintFee(uint256 investorShares)
        external
        view
        returns (
            uint256 grossShares,
            uint256 feeShares,
            uint256 creatorShares,
            uint256 buybackShares,
            uint16 creatorShareBps
        )
    {
        if (investorShares == 0) revert ZeroShares();
        grossShares = _grossMintShares(investorShares);
        feeShares = grossShares - investorShares;
        creatorShareBps = feeCreatorShareBps();
        (creatorShares, buybackShares) = _splitFeeShares(feeShares, creatorShareBps);
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
        uint256 effectiveSupply = totalSupply() + pendingExpenseFeeShares();
        uint256 denominator = effectiveSupply == 0 ? WAD : effectiveSupply;
        uint256 grossShares = type(uint256).max;
        bool anyQuantity;
        for (uint256 i = 0; i < length; i++) {
            uint256 quantity = effectiveSupply == 0
                ? _bootstrapBasketUnitsPerOTF[_assets[i]]
                : _accountedBalance[_assets[i]];
            if (quantity == 0) continue;
            anyQuantity = true;
            uint256 assetShares = Math.mulDiv(maxAmountsIn[i], denominator, quantity);
            if (assetShares < grossShares) grossShares = assetShares;
        }
        if (!anyQuantity) grossShares = 0;
        shares = Math.mulDiv(grossShares, BPS - _mintFeeBps, BPS);
        if (effectiveSupply == 0 && shares < MINIMUM_SHARE_SUPPLY) shares = 0;
        if (shares == 0) return (0, new uint256[](length));
        amountsIn = _previewMintWithSupply(_grossMintShares(shares), effectiveSupply);
    }

    function previewRedeem(uint256 shares) public view returns (uint256[] memory amountsOut) {
        if (shares == 0) revert ZeroShares();
        uint256 effectiveSupply =
            _shutdown ? totalSupply() : totalSupply() + pendingExpenseFeeShares();
        amountsOut = _previewRedeemWithSupply(
            _shutdown ? shares : _netRedeemShares(shares), effectiveSupply
        );
    }

    function previewRedeemFee(uint256 investorShares)
        external
        view
        returns (
            uint256 redeemedShares,
            uint256 feeShares,
            uint256 creatorShares,
            uint256 buybackShares,
            uint16 creatorShareBps
        )
    {
        if (investorShares == 0) revert ZeroShares();
        redeemedShares = _shutdown ? investorShares : _netRedeemShares(investorShares);
        feeShares = investorShares - redeemedShares;
        creatorShareBps = feeCreatorShareBps();
        (creatorShares, buybackShares) = _splitFeeShares(feeShares, creatorShareBps);
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
        uint16 creatorShareBps = feeCreatorShareBps();
        _requireBackingSound();
        if (totalSupply() == 0 && shares < MINIMUM_SHARE_SUPPLY) {
            revert BootstrapSharesTooSmall(shares, MINIMUM_SHARE_SUPPLY);
        }
        uint256[] memory balancesBefore = _actualBalances();
        uint256[] memory senderBalancesBefore = _basketBalances(msg.sender);
        uint256 grossShares = _grossMintShares(shares);
        amountsIn = _previewMintWithSupply(grossShares, totalSupply());
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
        (uint256 creatorShares, uint256 buybackShares) =
            _mintFeeShares(grossShares - shares, creatorShareBps);
        _resetFeeEpoch();
        emit BasketMinted(msg.sender, receiver, shares, amountsIn);
        emit MintFeeCharged(grossShares, shares, creatorShares, buybackShares, creatorShareBps);
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
        uint16 creatorShareBps = feeCreatorShareBps();
        _requireBackingSound();
        uint256[] memory balancesBefore = _actualBalances();
        uint256[] memory receiverBalancesBefore = _basketBalances(receiver);
        uint256 redeemedShares = _netRedeemShares(shares);
        amountsOut = _previewRedeemWithSupply(redeemedShares, totalSupply());
        for (uint256 i = 0; i < length; i++) {
            if (amountsOut[i] < minAmountsOut[i]) {
                revert AmountTooLow(_assets[i], amountsOut[i], minAmountsOut[i]);
            }
        }
        if (owner != msg.sender) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        (uint256 creatorShares, uint256 buybackShares) =
            _mintFeeShares(shares - redeemedShares, creatorShareBps);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 amount = amountsOut[i];
            _accountedBalance[asset] -= amount;
            _pushExact(asset, receiver, amount);
        }
        _requireExpectedBalances(balancesBefore, amountsOut, false);
        _requireExpectedAccountBalances(receiver, receiverBalancesBefore, amountsOut, true);
        emit BasketRedeemed(msg.sender, owner, receiver, shares, amountsOut);
        emit RedeemFeeCharged(shares, redeemedShares, creatorShares, buybackShares, creatorShareBps);
        _shutdownIfSupplyTooLow();
        if (!_shutdown) _resetFeeEpoch();
    }

    /// @notice Burns the caller's shares for basket assets without using swap liquidity.
    /// @dev Skipped entitlements are irrevocably forfeited and become unaccounted vault excess.
    function redeemInKind(
        uint256 shares,
        address receiver,
        uint256[] calldata minAmountsOut,
        uint256 skipMask
    ) external onlyInitialized nonReentrant returns (uint256[] memory amountsOut) {
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == address(this)) revert InvalidReceiver(receiver);
        if (shares == 0) revert ZeroShares();
        uint256 length = _assets.length;
        if (minAmountsOut.length != length) {
            revert InvalidArrayLength(length, minAmountsOut.length);
        }
        if (skipMask >> length != 0) revert InvalidSkipMask(skipMask, length);
        for (uint256 i = 0; i < length; i++) {
            if (_isSkipped(skipMask, i) && minAmountsOut[i] != 0) {
                revert SkippedAssetMinimumNotZero(_assets[i], minAmountsOut[i]);
            }
        }

        uint16 creatorShareBps;
        if (!_shutdown) {
            _accrueFees();
            creatorShareBps = feeCreatorShareBps();
        }
        uint256 supply = totalSupply();
        if (shares > supply) revert SharesExceedSupply(shares, supply);
        uint256 redeemedShares = _shutdown ? shares : _netRedeemShares(shares);

        amountsOut = new uint256[](length);
        uint256[] memory forfeitedAmounts = new uint256[](length);
        uint256[] memory accountedReductions = new uint256[](length);
        uint256[] memory vaultBalancesBefore = new uint256[](length);
        uint256[] memory receiverBalancesBefore = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            address asset = _assets[i];
            uint256 accounted = _accountedBalance[asset];
            uint256 reduction = redeemedShares == supply
                ? accounted
                : Math.mulDiv(accounted, redeemedShares, supply);
            accountedReductions[i] = reduction;
            if (_isSkipped(skipMask, i)) {
                forfeitedAmounts[i] = reduction;
                continue;
            }

            uint256 actual = IERC20(asset).balanceOf(address(this));
            vaultBalancesBefore[i] = actual;
            receiverBalancesBefore[i] = IERC20(asset).balanceOf(receiver);
            uint256 distributable = actual < accounted ? actual : accounted;
            uint256 amount = redeemedShares == supply
                ? distributable
                : Math.mulDiv(distributable, redeemedShares, supply);
            amountsOut[i] = amount;
            if (amount < minAmountsOut[i]) {
                revert AmountTooLow(asset, amount, minAmountsOut[i]);
            }
        }

        _burn(msg.sender, shares);
        (uint256 creatorShares, uint256 buybackShares) = _shutdown
            ? (uint256(0), uint256(0))
            : _mintFeeShares(shares - redeemedShares, creatorShareBps);
        for (uint256 i = 0; i < length; i++) {
            _accountedBalance[_assets[i]] -= accountedReductions[i];
        }
        _shutdownIfSupplyTooLow();

        for (uint256 i = 0; i < length; i++) {
            if (_isSkipped(skipMask, i)) continue;
            address asset = _assets[i];
            uint256 currentVaultBalance = IERC20(asset).balanceOf(address(this));
            if (currentVaultBalance != vaultBalancesBefore[i]) {
                revert AssetTransferMismatch(
                    asset, vaultBalancesBefore[i], vaultBalancesBefore[i], currentVaultBalance
                );
            }
            uint256 currentReceiverBalance = IERC20(asset).balanceOf(receiver);
            if (currentReceiverBalance != receiverBalancesBefore[i]) {
                revert BasketAccountBalanceChanged(
                    asset, receiver, receiverBalancesBefore[i], currentReceiverBalance
                );
            }
            _pushExact(asset, receiver, amountsOut[i]);
        }
        _requireExpectedUnskippedBalances(
            receiver, vaultBalancesBefore, receiverBalancesBefore, amountsOut, skipMask
        );
        if (!_shutdown) _resetFeeEpoch();
        emit InKindRedeemed(msg.sender, receiver, shares, amountsOut, forfeitedAmounts, skipMask);
        if (shares != redeemedShares) {
            emit RedeemFeeCharged(
                shares, redeemedShares, creatorShares, buybackShares, creatorShareBps
            );
        }
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
        uint256 supply = totalSupply();
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
        if (supply == 0 && shares < MINIMUM_SHARE_SUPPLY) {
            revert BootstrapSharesTooSmall(shares, MINIMUM_SHARE_SUPPLY);
        }
        uint256 length = _assets.length;
        amountsIn = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            uint256 quantity = supply == 0
                ? _bootstrapBasketUnitsPerOTF[_assets[i]]
                : _accountedBalance[_assets[i]];
            uint256 denominator = supply == 0 ? WAD : supply;
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

        uint16 creatorShareBps = feeCreatorShareBps();
        (uint256 creatorShares, uint256 buybackShares) =
            _mintExpenseFeeShares(totalFeeShares, creatorShareBps);
        emit ExpenseFeesCheckpointed(totalFeeShares, creatorShares, buybackShares, creatorShareBps);
    }

    function _splitFeeShares(uint256 feeShares, uint16 creatorShareBps)
        internal
        pure
        returns (uint256 creatorShares, uint256 buybackShares)
    {
        creatorShares = Math.mulDiv(feeShares, creatorShareBps, BPS);
        buybackShares = feeShares - creatorShares;
    }

    function _mintFeeShares(uint256 feeShares, uint16 creatorShareBps)
        internal
        returns (uint256 creatorShares, uint256 buybackShares)
    {
        (creatorShares, buybackShares) = _splitFeeShares(feeShares, creatorShareBps);
        if (creatorShares != 0) _mint(_expenseBeneficiary, creatorShares);
        if (buybackShares != 0) _mint(_buybackCollector, buybackShares);
    }

    /// @dev Carries only the annual-expense split remainder so checkpoint cadence cannot change it.
    function _splitExpenseFeeShares(uint256 feeShares, uint16 creatorShareBps)
        internal
        view
        returns (uint256 creatorShares, uint256 buybackShares, uint256 nextRemainderBps)
    {
        creatorShares = Math.mulDiv(feeShares, creatorShareBps, BPS);
        nextRemainderBps =
            mulmod(feeShares, creatorShareBps, BPS) + _expenseCreatorSplitRemainderBps;
        creatorShares += nextRemainderBps / BPS;
        nextRemainderBps %= BPS;
        buybackShares = feeShares - creatorShares;
    }

    function _mintExpenseFeeShares(uint256 feeShares, uint16 creatorShareBps)
        internal
        returns (uint256 creatorShares, uint256 buybackShares)
    {
        uint256 nextRemainderBps;
        (creatorShares, buybackShares, nextRemainderBps) =
            _splitExpenseFeeShares(feeShares, creatorShareBps);
        _expenseCreatorSplitRemainderBps = nextRemainderBps;
        if (creatorShares != 0) _mint(_expenseBeneficiary, creatorShares);
        if (buybackShares != 0) _mint(_buybackCollector, buybackShares);
    }

    function _grossMintShares(uint256 investorShares) internal view returns (uint256) {
        if (_mintFeeBps == 0) return investorShares;
        return Math.mulDiv(investorShares, BPS, BPS - _mintFeeBps, Math.Rounding.Ceil);
    }

    function _netRedeemShares(uint256 investorShares) internal view returns (uint256 redeemed) {
        if (_redeemFeeBps == 0) return investorShares;
        uint256 feeShares = Math.mulDiv(investorShares, _redeemFeeBps, BPS, Math.Rounding.Ceil);
        redeemed = investorShares - feeShares;
        if (redeemed == 0) revert ZeroNetShares();
    }

    function _resetFeeEpoch() internal {
        (, uint256 remainderWad) = _feeTargetAt(uint64(block.timestamp));
        _feeShareRemainderWad = remainderWad;
        _feeEpochTimestamp = uint64(block.timestamp);
        _feeEpochSupply = totalSupply();
        _feeEpochAccruedShares = 0;
    }

    function _shutdownIfSupplyTooLow() internal {
        uint256 remainingSupply = totalSupply();
        if (_shutdown || remainingSupply >= MINIMUM_SHARE_SUPPLY) return;
        _shutdown = true;
        _shutdownAt = uint64(block.timestamp);
        emit LowSupplyShutdown(msg.sender, _shutdownAt, remainingSupply);
    }

    function _isSkipped(uint256 skipMask, uint256 index) internal pure returns (bool) {
        return ((skipMask >> index) & 1) != 0;
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

    function _requireExpectedUnskippedBalances(
        address receiver,
        uint256[] memory vaultBalancesBefore,
        uint256[] memory receiverBalancesBefore,
        uint256[] memory amountsOut,
        uint256 skipMask
    ) internal view {
        uint256 length = _assets.length;
        for (uint256 i = 0; i < length; i++) {
            if (_isSkipped(skipMask, i)) continue;
            address asset = _assets[i];
            uint256 expectedVaultBalance = vaultBalancesBefore[i] - amountsOut[i];
            uint256 actualVaultBalance = IERC20(asset).balanceOf(address(this));
            if (actualVaultBalance != expectedVaultBalance) {
                revert BasketBalanceChanged(asset, expectedVaultBalance, actualVaultBalance);
            }
            uint256 expectedReceiverBalance = receiverBalancesBefore[i] + amountsOut[i];
            uint256 actualReceiverBalance = IERC20(asset).balanceOf(receiver);
            if (actualReceiverBalance != expectedReceiverBalance) {
                revert BasketAccountBalanceChanged(
                    asset, receiver, expectedReceiverBalance, actualReceiverBalance
                );
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
