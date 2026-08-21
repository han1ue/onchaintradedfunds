// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum OracleValidationMode {
    StandardChainlink,
    RobinhoodStockToken
}

uint32 constant MAX_ORACLE_STALENESS = 7 days;
