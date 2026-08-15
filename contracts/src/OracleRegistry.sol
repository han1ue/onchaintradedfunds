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

    event OracleConfigSet(
        address indexed asset,
        address indexed feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    );
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
    mapping(address => OracleConfig) private _oracleConfigFor;

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
        return address(_oracleConfigFor[asset].feed);
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
        OracleConfig storage config = _oracleConfigFor[asset];
        return (config.feed, config.maxStaleness, config.validationMode);
    }

    function setOracleConfig(
        address asset,
        AggregatorV3Interface feed,
        uint32 maxStaleness,
        OracleValidationMode validationMode
    ) external onlyOwner {
        if (asset == address(0) || address(feed) == address(0)) {
            revert ZeroAddress();
        }
        if (asset.code.length == 0) revert AssetNotContract(asset);
        if (address(feed).code.length == 0) revert FeedNotContract(address(feed));
        if (maxStaleness == 0) revert InvalidMaxStaleness();
        _oracleConfigFor[asset] = OracleConfig({
            feed: feed, maxStaleness: maxStaleness, validationMode: validationMode
        });
        emit OracleConfigSet(asset, address(feed), maxStaleness, validationMode);
    }
}
