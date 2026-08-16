// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AggregatorV3Interface } from "./AggregatorV3Interface.sol";

enum OracleValidationMode {
    StandardChainlink,
    RobinhoodStockToken
}

interface IOracleRegistry {
    function usdQuote() external pure returns (address);

    function priceFeedFor(address asset) external view returns (address);

    function oracleConfigFor(address asset)
        external
        view
        returns (
            AggregatorV3Interface feed,
            uint32 maxStaleness,
            OracleValidationMode validationMode
        );

    function oracleConfigForPair(address base, address quote)
        external
        view
        returns (
            AggregatorV3Interface feed,
            uint32 maxStaleness,
            OracleValidationMode validationMode
        );
}
