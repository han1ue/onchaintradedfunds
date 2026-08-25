// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetMarketRegistry {
    function quoteTokenFor(bytes32 marketId) external view returns (address);

    function quoteTokenConfig(address quoteToken)
        external
        view
        returns (
            address usdFeed,
            uint32 maxStaleness,
            bool enabled,
            bool allowComposedChainlink,
            bool allowV3Twap
        );

    function validateQuoteToken(
        address quoteToken,
        address usdFeed,
        uint32 maxStaleness,
        bool forV3
    ) external view;

    function registerV3Market(address asset, address pool) external returns (bytes32 marketId);

    function marketFor(bytes32 marketId)
        external
        view
        returns (address asset, address pool, uint24 fee, bool active);
}
