// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPriceFeed } from "../interfaces/IPriceFeed.sol";

/// @notice Owner-controlled Chainlink V3-compatible feed for testnet development only.
contract TestnetMockPriceFeed is IPriceFeed {
    error InvalidAnswer(int256 answer);
    error InvalidDecimals(uint8 decimals_);
    error NotOwner();
    error RoundUnavailable(uint80 roundId);
    error ZeroAddress();

    event AnswerUpdated(int256 indexed answer, uint80 indexed roundId, uint256 updatedAt);

    address public immutable owner;
    uint8 public immutable decimals;
    string public description;
    uint256 public constant version = 1;

    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;

    constructor(address owner_, uint8 decimals_, int256 answer_, string memory description_) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (decimals_ > 18) revert InvalidDecimals(decimals_);
        owner = owner_;
        decimals = decimals_;
        description = description_;
        _setAnswer(answer_);
    }

    function setAnswer(int256 answer_) external {
        if (msg.sender != owner) revert NotOwner();
        _setAnswer(answer_);
    }

    function getRoundData(uint80 requestedRoundId)
        external
        view
        returns (
            uint80 roundId_,
            int256 answer_,
            uint256 startedAt_,
            uint256 updatedAt_,
            uint80 answeredInRound_
        )
    {
        if (requestedRoundId != roundId) revert RoundUnavailable(requestedRoundId);
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId_,
            int256 answer_,
            uint256 startedAt_,
            uint256 updatedAt_,
            uint80 answeredInRound_
        )
    {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function _setAnswer(int256 answer_) private {
        if (answer_ <= 0) revert InvalidAnswer(answer_);
        roundId += 1;
        answer = answer_;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
        emit AnswerUpdated(answer_, roundId, block.timestamp);
    }
}
