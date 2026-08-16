// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetMarketRegistry {
    function weth() external view returns (address);
    function usdg() external view returns (address);
    function wethUsdgPool() external view returns (address);

    function marketFor(bytes32 marketId)
        external
        view
        returns (
            address asset,
            address pool,
            address priceFeed,
            uint24 fee,
            bool active
        );

    function isActiveMarketForAsset(bytes32 marketId, address asset)
        external
        view
        returns (bool);
}
