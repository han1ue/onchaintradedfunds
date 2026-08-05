// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StrategyVersion } from "../VaultTypes.sol";

interface IManagedOTFStrategyHistory {
    function strategyVersionCount() external view returns (uint256);
    function getStrategyVersion(uint256 index) external view returns (StrategyVersion memory);
    function getStrategyTargets(uint256 index)
        external
        view
        returns (address[] memory tokens, uint16[] memory weights);
    function pendingStrategyRationale() external view returns (string memory);
    function nextStrategyRationale() external view returns (string memory);
}
