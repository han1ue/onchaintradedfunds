// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOTFSettlementFactory {
    function buybackCollector() external view returns (address);

    function isVault(address vault) external view returns (bool);
}

interface IOTFSettlementVault {
    function assets() external view returns (address[] memory);

    function balanceOf(address account) external view returns (uint256);

    function checkpointFees() external returns (uint256 totalFeeShares);

    function previewMaxMint(uint256[] calldata maxAmountsIn)
        external
        view
        returns (uint256 shares, uint256[] memory amountsIn);

    function routerMint(uint256 shares, address receiver, uint256[] calldata maxAmountsIn)
        external
        returns (uint256[] memory amountsIn);

    function routerRedeem(
        uint256 shares,
        address owner,
        address receiver,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory amountsOut);
}
