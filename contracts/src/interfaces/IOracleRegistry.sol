// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOracleRegistry {
    function priceFeedFor(address asset) external view returns (address);
}

