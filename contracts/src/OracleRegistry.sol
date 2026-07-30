// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IOracleRegistry } from "./interfaces/IOracleRegistry.sol";

contract OracleRegistry is IOracleRegistry {
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error AssetNotContract(address asset);
    error FeedNotContract(address feed);

    event PriceFeedSet(address indexed asset, address indexed feed);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
    mapping(address => address) public priceFeedFor;

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

    function setPriceFeed(address asset, address feed) external onlyOwner {
        if (asset == address(0) || feed == address(0)) revert ZeroAddress();
        if (asset.code.length == 0) revert AssetNotContract(asset);
        if (feed.code.length == 0) revert FeedNotContract(feed);
        priceFeedFor[asset] = feed;
        emit PriceFeedSet(asset, feed);
    }
}
