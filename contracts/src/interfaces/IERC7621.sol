// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Interface surface synchronized with the official draft at
/// https://github.com/ethereum/ERCs/blob/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/assets/erc-7621/contracts/interfaces/IERC7621.sol
/// Interface equality does not by itself imply behavioral conformance.
interface IERC7621 {
    error LengthMismatch(uint256 expected, uint256 actual);
    error InvalidWeights(uint256 weightSum);
    error ZeroAmount();
    error NotConstituent(address token);
    error InsufficientShares(uint256 minimum, uint256 actual);
    error InsufficientAmount(uint256 index, uint256 minimum, uint256 actual);
    error DuplicateConstituent(address token);
    error ZeroAddress();

    event Contributed(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Withdrawn(
        address indexed caller, address indexed receiver, uint256 lpAmount, uint256[] amounts
    );
    event Rebalanced(address[] newTokens, uint256[] newWeights);

    function getConstituents()
        external
        view
        returns (address[] memory tokens, uint256[] memory weights);

    function totalConstituents() external view returns (uint256 count);
    function getReserve(address token) external view returns (uint256 balance);
    function getWeight(address token) external view returns (uint256 weight);
    function isConstituent(address token) external view returns (bool);
    function totalBasketValue() external view returns (uint256 value);

    function contribute(uint256[] calldata amounts, address receiver, uint256 minShares)
        external
        returns (uint256 lpAmount);

    function withdraw(uint256 lpAmount, address receiver, uint256[] calldata minAmounts)
        external
        returns (uint256[] memory amounts);

    function rebalance(address[] calldata newTokens, uint256[] calldata newWeights) external;
    function previewContribute(uint256[] calldata amounts) external view returns (uint256 lpAmount);
    function previewWithdraw(uint256 lpAmount) external view returns (uint256[] memory amounts);
}
