// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OracleValidationMode } from "./IOracleTypes.sol";

interface IAssetMarketRegistry {
    function weth() external view returns (address);
    function usdg() external view returns (address);
    function quoteTokenFor(bytes32 marketId) external view returns (address);

    function validateQuoteToken(
        address quoteToken,
        address usdFeed,
        uint32 maxStaleness,
        OracleValidationMode validationMode,
        bool forV3
    ) external view;

    function registerV3Market(address asset, address pool) external returns (bytes32 marketId);

    function marketFor(bytes32 marketId)
        external
        view
        returns (address asset, address pool, uint24 fee, bool active);

    function isActiveMarketForAsset(bytes32 marketId, address asset) external view returns (bool);
}
