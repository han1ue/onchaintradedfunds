// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20, IERC20Metadata } from "./interfaces/IERC20.sol";
import { ManagedOTFVault } from "./ManagedOTFVault.sol";
import { ProtocolConstants } from "./libraries/ProtocolConstants.sol";
import { FormationSnapshot, VaultCreationParams, VaultInitParams } from "./VaultTypes.sol";

interface ICanonicalEntryExitRouter {
    function factory() external view returns (address);
}

interface IERC1271FormationAuthority {
    function isValidSignature(bytes32 digest, bytes calldata signature)
        external
        view
        returns (bytes4 magicValue);
}

interface IFormationVaultView {
    function assets() external view returns (address[] memory);
    function accountedBalance(address asset) external view returns (uint256);
    function formationOtfWeightBps() external view returns (uint16);
}

/// @notice Permissionless OTF formation from one-use, authority-signed market-cap snapshots.
contract OTFFactory {
    uint256 private constant BPS = ProtocolConstants.BPS;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant EIP712_NAME_HASH = keccak256("OTFFactory");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");
    bytes32 public constant FORMATION_SNAPSHOT_TYPEHASH = keccak256(
        "FormationSnapshot(uint256 chainId,address factory,address creator,address[] constituents,uint8[] tokenDecimals,uint256[] marketCapsUsdWad,uint256[] unitPricesUsdWad,uint64 snapshotTime,uint64 expiry,uint32 calculationVersion,uint256 nonce)"
    );
    uint32 public constant FORMATION_CALCULATION_VERSION =
        ProtocolConstants.FORMATION_CALCULATION_VERSION;
    uint256 public constant MAX_CONSTITUENTS = ProtocolConstants.MAX_CONSTITUENTS;
    uint8 public constant MAX_CONSTITUENT_DECIMALS = ProtocolConstants.MAX_CONSTITUENT_DECIMALS;
    uint16 public constant MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS =
        ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS;

    error InvalidImplementation();
    error InvalidDependency(address dependency);
    error ZeroAddress();
    error RouterAlreadyConfigured();
    error RouterNotConfigured();
    error UnauthorizedRouterConfigurator(address caller);
    error RouterFactoryMismatch(address expected, address actual);
    error InvalidVaultMetadata();
    error ExpenseRatioTooHigh(uint16 supplied, uint16 maximum);
    error InvalidSnapshotDomain(uint256 chainId, address factory);
    error InvalidSnapshotTime(uint64 snapshotTime, uint64 expiry, uint256 currentTime);
    error UnsupportedCalculationVersion(uint32 supplied, uint32 expected);
    error InvalidSnapshotArrayLength(
        uint256 constituents, uint256 tokenDecimals, uint256 marketCaps, uint256 prices
    );
    error InvalidConstituent(address constituent);
    error DuplicateConstituent(address constituent);
    error SelfConstituent(address constituent);
    error InvalidMarketData(uint256 index);
    error MarketCapSumOverflow();
    error UnsupportedTokenDecimals(address token, uint8 decimals_);
    error TokenDecimalsUnavailable(address token);
    error TokenDecimalsMismatch(address token, uint8 expected, uint8 observed);
    error ZeroRelativeQuantity(address token);
    error InvalidFormationSignature(address recovered);
    error InvalidFormationCreator(address creator);
    error UnauthorizedFormationCreator(address caller, address creator);
    error FormationNonceAlreadyUsed(uint256 nonce);
    error FormationSnapshotAlreadyUsed(bytes32 digest);
    error Reentrancy();
    error InvalidVault(address vault);
    error InvalidProtocolFeePolicy(uint16 protocolShareBps, uint16 thresholdBps);

    event EntryExitRouterConfigured(address indexed router);
    event VaultCreated(
        address indexed creator,
        address indexed vault,
        bytes32 indexed formationSnapshotDigest,
        string name,
        string symbol
    );

    address public immutable vaultImplementation;
    address public immutable feeCollector;
    address public immutable formationSnapshotAuthority;
    address public immutable protocolToken;
    address public immutable routerConfigurator;
    uint16 public immutable baseProtocolFeeShareBps;
    uint16 public immutable protocolTokenFullRebateThresholdBps;

    address public entryExitRouter;
    address[] private _vaults;
    mapping(address => bool) public isVault;
    mapping(uint256 => bool) public formationNonceUsed;
    mapping(bytes32 => bool) public formationSnapshotUsed;
    bool private _creating;

    constructor(
        address vaultImplementation_,
        address feeCollector_,
        address formationSnapshotAuthority_,
        address protocolToken_,
        uint16 baseProtocolFeeShareBps_,
        uint16 protocolTokenFullRebateThresholdBps_
    ) {
        if (vaultImplementation_.code.length == 0) {
            revert InvalidImplementation();
        }
        if (feeCollector_.code.length == 0) revert InvalidDependency(feeCollector_);
        if (formationSnapshotAuthority_ == address(0)) revert ZeroAddress();
        if (baseProtocolFeeShareBps_ > ProtocolConstants.BPS) {
            revert InvalidProtocolFeePolicy(
                baseProtocolFeeShareBps_, protocolTokenFullRebateThresholdBps_
            );
        }
        if (protocolTokenFullRebateThresholdBps_ > ProtocolConstants.BPS) {
            revert InvalidProtocolFeePolicy(
                baseProtocolFeeShareBps_, protocolTokenFullRebateThresholdBps_
            );
        }
        if (
            protocolToken_ == address(0) && protocolTokenFullRebateThresholdBps_ != 0
                || protocolToken_ != address(0) && protocolToken_.code.length == 0
        ) {
            revert InvalidDependency(protocolToken_);
        }

        vaultImplementation = vaultImplementation_;
        feeCollector = feeCollector_;
        formationSnapshotAuthority = formationSnapshotAuthority_;
        protocolToken = protocolToken_;
        baseProtocolFeeShareBps = baseProtocolFeeShareBps_;
        protocolTokenFullRebateThresholdBps = protocolTokenFullRebateThresholdBps_;
        routerConfigurator = msg.sender;
    }

    modifier nonReentrantCreation() {
        if (_creating) revert Reentrancy();
        _creating = true;
        _;
        _creating = false;
    }

    /// @notice Breaks the factory/router constructor cycle. This can succeed exactly once.
    function configureEntryExitRouter(address router) external {
        if (msg.sender != routerConfigurator) revert UnauthorizedRouterConfigurator(msg.sender);
        if (entryExitRouter != address(0)) revert RouterAlreadyConfigured();
        if (router.code.length == 0) revert InvalidDependency(router);
        address observedFactory;
        try ICanonicalEntryExitRouter(router).factory() returns (address factory_) {
            observedFactory = factory_;
        } catch {
            revert InvalidDependency(router);
        }
        if (observedFactory != address(this)) {
            revert RouterFactoryMismatch(address(this), observedFactory);
        }
        entryExitRouter = router;
        emit EntryExitRouterConfigured(router);
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function formationSnapshotDigest(FormationSnapshot calldata snapshot)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                FORMATION_SNAPSHOT_TYPEHASH,
                snapshot.chainId,
                snapshot.factory,
                snapshot.creator,
                keccak256(abi.encodePacked(snapshot.constituents)),
                keccak256(abi.encodePacked(snapshot.tokenDecimals)),
                keccak256(abi.encodePacked(snapshot.marketCapsUsdWad)),
                keccak256(abi.encodePacked(snapshot.unitPricesUsdWad)),
                snapshot.snapshotTime,
                snapshot.expiry,
                snapshot.calculationVersion,
                snapshot.nonce
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                EIP712_NAME_HASH,
                EIP712_VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function predictVaultAddress(FormationSnapshot calldata snapshot)
        external
        view
        returns (address)
    {
        bytes32 digest = formationSnapshotDigest(snapshot);
        return Clones.predictDeterministicAddress(vaultImplementation, digest, address(this));
    }

    function previewRelativeQuantities(FormationSnapshot calldata snapshot)
        external
        view
        returns (uint256[] memory relativeQuantities, uint16 formationOtfWeightBps)
    {
        bytes32 digest = formationSnapshotDigest(snapshot);
        address predicted =
            Clones.predictDeterministicAddress(vaultImplementation, digest, address(this));
        return _validateAndDeriveSnapshot(snapshot, predicted, false);
    }

    function createVault(
        VaultCreationParams calldata params,
        FormationSnapshot calldata snapshot,
        bytes calldata authoritySignature
    ) external nonReentrantCreation returns (address vault) {
        if (snapshot.creator == address(0)) {
            revert InvalidFormationCreator(snapshot.creator);
        }
        if (msg.sender != snapshot.creator) {
            revert UnauthorizedFormationCreator(msg.sender, snapshot.creator);
        }
        address router = entryExitRouter;
        if (router == address(0)) revert RouterNotConfigured();
        if (
            bytes(params.name).length == 0 || bytes(params.symbol).length == 0
                || params.expenseBeneficiary == address(0)
        ) revert InvalidVaultMetadata();
        if (
            params.annualCreatorExpenseRatioBps
                > ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS
        ) {
            revert ExpenseRatioTooHigh(
                params.annualCreatorExpenseRatioBps,
                ProtocolConstants.MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS
            );
        }

        bytes32 digest = formationSnapshotDigest(snapshot);
        if (formationNonceUsed[snapshot.nonce]) {
            revert FormationNonceAlreadyUsed(snapshot.nonce);
        }
        if (formationSnapshotUsed[digest]) revert FormationSnapshotAlreadyUsed(digest);
        (bool validSignature, address recovered) =
            _isValidAuthoritySignature(digest, authoritySignature);
        if (!validSignature) revert InvalidFormationSignature(recovered);

        vault = Clones.predictDeterministicAddress(vaultImplementation, digest, address(this));
        (uint256[] memory relativeQuantities, uint16 formationOtfWeightBps) =
            _validateAndDeriveSnapshot(snapshot, vault, true);
        formationNonceUsed[snapshot.nonce] = true;
        formationSnapshotUsed[digest] = true;

        address deployed = Clones.cloneDeterministic(vaultImplementation, digest);
        if (deployed != vault) revert InvalidVault(deployed);
        ManagedOTFVault(vault)
            .initialize(
                VaultInitParams({
                name: params.name,
                symbol: params.symbol,
                creator: snapshot.creator,
                expenseBeneficiary: params.expenseBeneficiary,
                entryExitRouter: router,
                feeCollector: feeCollector,
                constituents: snapshot.constituents,
                relativeQuantities: relativeQuantities,
                annualCreatorExpenseRatioBps: params.annualCreatorExpenseRatioBps,
                formationOtfWeightBps: formationOtfWeightBps,
                formationSnapshotTime: snapshot.snapshotTime,
                formationCalculationVersion: snapshot.calculationVersion,
                formationSnapshotDigest: digest
            })
            );

        isVault[vault] = true;
        _vaults.push(vault);
        emit VaultCreated(snapshot.creator, vault, digest, params.name, params.symbol);
    }

    /// @notice Immutable base protocol split after the signed formation-allocation rebate.
    /// @dev W=floor(G*coverage/10000); result rounds up so rounding never over-rebates.
    function effectiveProtocolFeeShareBps(address vault)
        external
        view
        returns (uint16 effectiveShareBps)
    {
        uint16 baseShare = baseProtocolFeeShareBps;
        uint16 threshold = protocolTokenFullRebateThresholdBps;
        address otf = protocolToken;
        if (baseShare == 0) return 0;
        if (otf == address(0) || threshold == 0 || !isVault[vault]) return baseShare;

        uint16 formationWeight;
        try IFormationVaultView(vault).formationOtfWeightBps() returns (uint16 weightBps) {
            formationWeight = weightBps;
        } catch {
            return baseShare;
        }
        if (formationWeight == 0 || formationWeight > BPS) return baseShare;

        address[] memory constituents;
        try IFormationVaultView(vault).assets() returns (address[] memory assets_) {
            constituents = assets_;
        } catch {
            return baseShare;
        }
        uint256 length = constituents.length;
        if (length == 0 || length > ProtocolConstants.MAX_CONSTITUENTS) return baseShare;

        bool foundOtf;
        uint256 otfAccounted;
        uint256 otfActual;
        for (uint256 i = 0; i < length; i++) {
            address asset = constituents[i];
            uint256 accounted;
            try IFormationVaultView(vault).accountedBalance(asset) returns (uint256 balance) {
                accounted = balance;
            } catch {
                return baseShare;
            }
            uint256 actual;
            try IERC20(asset).balanceOf(vault) returns (uint256 balance) {
                actual = balance;
            } catch {
                return baseShare;
            }
            if (actual < accounted) return baseShare;
            if (asset == otf) {
                if (foundOtf) return baseShare;
                foundOtf = true;
                otfAccounted = accounted;
                otfActual = actual;
            }
        }
        if (!foundOtf || otfAccounted == 0) return baseShare;

        uint256 coverageBps = Math.mulDiv(otfActual, BPS, otfAccounted);
        if (coverageBps > BPS) coverageBps = BPS;
        uint256 rebateWeightBps = Math.mulDiv(formationWeight, coverageBps, BPS);
        if (rebateWeightBps >= threshold) return 0;
        return uint16(
            Math.mulDiv(
                baseShare, uint256(threshold) - rebateWeightBps, threshold, Math.Rounding.Ceil
            )
        );
    }

    function otfTokenURI() external pure returns (string memory) {
        return "data:application/json,{\"name\":\"Onchain Traded Fund\",\"symbol\":\"OTF\"}";
    }

    function _isValidAuthoritySignature(bytes32 digest, bytes calldata signature)
        private
        view
        returns (bool valid, address recovered)
    {
        address authority = formationSnapshotAuthority;
        if (authority.code.length == 0) {
            ECDSA.RecoverError recoverError;
            (recovered, recoverError,) = ECDSA.tryRecoverCalldata(digest, signature);
            valid = recoverError == ECDSA.RecoverError.NoError && recovered == authority;
            return (valid, recovered);
        }

        (bool success, bytes memory result) = authority.staticcall(
            abi.encodeCall(IERC1271FormationAuthority.isValidSignature, (digest, signature))
        );
        valid =
            success && result.length >= 32 && abi.decode(result, (bytes4)) == ERC1271_MAGIC_VALUE;
    }

    function _validateAndDeriveSnapshot(
        FormationSnapshot calldata snapshot,
        address predictedVault,
        bool validateTimeAndDomain
    ) private view returns (uint256[] memory relativeQuantities, uint16 formationOtfWeightBps) {
        if (validateTimeAndDomain) {
            if (snapshot.chainId != block.chainid || snapshot.factory != address(this)) {
                revert InvalidSnapshotDomain(snapshot.chainId, snapshot.factory);
            }
            uint256 currentTime = block.timestamp;
            if (
                snapshot.snapshotTime > currentTime || currentTime >= snapshot.expiry
                    || snapshot.expiry <= snapshot.snapshotTime
            ) {
                revert InvalidSnapshotTime(snapshot.snapshotTime, snapshot.expiry, currentTime);
            }
        }
        if (snapshot.calculationVersion != ProtocolConstants.FORMATION_CALCULATION_VERSION) {
            revert UnsupportedCalculationVersion(
                snapshot.calculationVersion, ProtocolConstants.FORMATION_CALCULATION_VERSION
            );
        }

        uint256 length = snapshot.constituents.length;
        if (
            length == 0 || length > ProtocolConstants.MAX_CONSTITUENTS
                || snapshot.tokenDecimals.length != length
                || snapshot.marketCapsUsdWad.length != length
                || snapshot.unitPricesUsdWad.length != length
        ) {
            revert InvalidSnapshotArrayLength(
                length,
                snapshot.tokenDecimals.length,
                snapshot.marketCapsUsdWad.length,
                snapshot.unitPricesUsdWad.length
            );
        }

        uint256 totalMarketCap;
        for (uint256 i = 0; i < length; i++) {
            address asset = snapshot.constituents[i];
            if (asset == address(0) || asset.code.length == 0) {
                revert InvalidConstituent(asset);
            }
            if (asset == predictedVault) revert SelfConstituent(asset);
            for (uint256 j = 0; j < i; j++) {
                if (snapshot.constituents[j] == asset) revert DuplicateConstituent(asset);
            }
            uint256 marketCap = snapshot.marketCapsUsdWad[i];
            if (marketCap == 0 || snapshot.unitPricesUsdWad[i] == 0) {
                revert InvalidMarketData(i);
            }
            if (marketCap > type(uint256).max - totalMarketCap) revert MarketCapSumOverflow();
            totalMarketCap += marketCap;
        }

        relativeQuantities = new uint256[](length);
        address otf = protocolToken;
        for (uint256 i = 0; i < length; i++) {
            address asset = snapshot.constituents[i];
            uint8 expectedDecimals = snapshot.tokenDecimals[i];
            if (expectedDecimals > ProtocolConstants.MAX_CONSTITUENT_DECIMALS) {
                revert UnsupportedTokenDecimals(asset, expectedDecimals);
            }
            uint8 observedDecimals;
            try IERC20Metadata(asset).decimals() returns (uint8 tokenDecimals) {
                observedDecimals = tokenDecimals;
            } catch {
                revert TokenDecimalsUnavailable(asset);
            }
            if (observedDecimals != expectedDecimals) {
                revert TokenDecimalsMismatch(asset, expectedDecimals, observedDecimals);
            }

            // V1 intentionally floors both steps: formation weight, then raw token quantity.
            uint256 weightWad =
                Math.mulDiv(snapshot.marketCapsUsdWad[i], ProtocolConstants.WAD, totalMarketCap);
            uint256 quantity = Math.mulDiv(
                weightWad, 10 ** uint256(expectedDecimals), snapshot.unitPricesUsdWad[i]
            );
            if (quantity == 0) revert ZeroRelativeQuantity(asset);
            relativeQuantities[i] = quantity;
            if (asset == otf) {
                formationOtfWeightBps = uint16(
                    Math.mulDiv(snapshot.marketCapsUsdWad[i], ProtocolConstants.BPS, totalMarketCap)
                );
            }
        }
    }
}
