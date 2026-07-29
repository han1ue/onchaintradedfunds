// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IOracleRegistry } from "./interfaces/IOracleRegistry.sol";

contract OracleRegistry is IOracleRegistry {
    error NotOwner();
    error ZeroAddress();

    event PriceFeedSet(address indexed asset, address indexed feed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address public owner;
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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPriceFeed(address asset, address feed) external onlyOwner {
        if (asset == address(0) || feed == address(0)) revert ZeroAddress();
        priceFeedFor[asset] = feed;
        emit PriceFeedSet(asset, feed);
    }
}

