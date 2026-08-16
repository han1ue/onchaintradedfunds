// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IOracleRegistry, OracleValidationMode } from "./interfaces/IOracleRegistry.sol";

contract OracleRegistry is IOracleRegistry {
    struct OracleConfig {
        AggregatorV3Interface feed;
        uint32 maxStaleness;
        OracleValidationMode validationMode;
    }

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error AssetNotContract(address asset);
    error FeedNotContract(address feed);
    error InvalidMaxStaleness();
    error MaxStalenessTooHigh(uint32 supplied, uint32 maximum);

    event OracleConfigSet(
        address indexed asset,
        address indexed feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    );
    event OracleRouteSet(
        address indexed base,
        address indexed quote,
        address indexed feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    );
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
    /// @notice ISO-4217 USD sentinel used as the quote key for direct USD feeds.
    address public constant USD_QUOTE = address(840);
    uint32 public constant MAX_ORACLE_STALENESS = 7 days;
    mapping(address => mapping(address => OracleConfig)) private _oracleConfigForPair;

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function beginOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnershipTransfer() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function priceFeedFor(address asset) external view returns (address) {
        return address(_oracleConfigForPair[asset][USD_QUOTE].feed);
    }

    function usdQuote() external pure returns (address) {
        return USD_QUOTE;
    }

    function oracleConfigFor(address asset)
        external
        view
        returns (
            AggregatorV3Interface feed,
            uint32 maxStaleness,
            OracleValidationMode validationMode
        )
    {
        OracleConfig storage config = _oracleConfigForPair[asset][USD_QUOTE];
        return (config.feed, config.maxStaleness, config.validationMode);
    }

    function oracleConfigForPair(address base, address quote)
        external
        view
        returns (
            AggregatorV3Interface feed,
            uint32 maxStaleness,
            OracleValidationMode validationMode
        )
    {
        OracleConfig storage config = _oracleConfigForPair[base][quote];
        return (config.feed, config.maxStaleness, config.validationMode);
    }

    function setOracleConfig(
        address asset,
        AggregatorV3Interface feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) external onlyOwner {
        _setOracleRoute(asset, USD_QUOTE, feed, maxStaleness, validationMode);
        emit OracleConfigSet(asset, address(feed), maxStaleness, validationMode);
    }

    function setOracleRoute(
        address base,
        address quote,
        AggregatorV3Interface feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) external onlyOwner {
        _setOracleRoute(base, quote, feed, maxStaleness, validationMode);
    }

    function _setOracleRoute(
        address base,
        address quote,
        AggregatorV3Interface feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) private {
        if (base == address(0) || quote == address(0) || address(feed) == address(0)) {
            revert ZeroAddress();
        }
        if (base.code.length == 0) revert AssetNotContract(base);
        if (quote != USD_QUOTE && quote.code.length == 0) revert AssetNotContract(quote);
        if (address(feed).code.length == 0) revert FeedNotContract(address(feed));
        if (maxStaleness == 0) revert InvalidMaxStaleness();
        if (maxStaleness > MAX_ORACLE_STALENESS) {
            revert MaxStalenessTooHigh(maxStaleness, MAX_ORACLE_STALENESS);
        }
        _oracleConfigForPair[base][quote] = OracleConfig({
            feed: feed, maxStaleness: maxStaleness, validationMode: validationMode
        });
        emit OracleRouteSet(base, quote, address(feed), maxStaleness, validationMode);
    }
}
