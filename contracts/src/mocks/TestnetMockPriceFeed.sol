// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPriceFeed } from "../interfaces/IPriceFeed.sol";

/// @notice Self-updating Chainlink V3-compatible synthetic feed for testnet development only.
/// @dev Prices are deterministic functions of chain time. They are predictable and MUST NOT be
///      used as production or adversarial-test oracles.
contract TestnetMockPriceFeed is IPriceFeed {
    error InvalidAnswer(int256 answer);
    error InvalidDecimals(uint8 decimals_);
    error NotOwner();
    error RoundUnavailable(uint80 roundId);
    error ZeroAddress();

    event AnswerUpdated(int256 indexed answer, uint80 indexed roundId, uint256 updatedAt);

    int256 private constant BPS_INT = 10_000;
    uint256 private constant PRICE_EPOCH = 5 minutes;
    int256 private constant MAX_PRICE_FACTOR_BPS = 100_000;
    int256 private constant MIN_PRICE_FACTOR_BPS = 1_000;
    uint256 private constant START_LAG_RANGE = 13;
    uint256 private constant DRIFT_BPS_PER_DAY = 5;
    uint256 private constant MAX_DRIFT_BPS = 90_000;
    uint256 private constant VOLATILITY_BPS = 50;
    int256 private constant VOLATILITY_BPS_INT = 50;

    address public immutable owner;
    uint8 public immutable decimals;
    string public description;
    uint256 public constant version = 2;

    int256 public baseAnswer;
    uint256 public baseTimestamp;
    bytes32 private immutable _pathSeed;

    constructor(address owner_, uint8 decimals_, int256 answer_, string memory description_) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (decimals_ > 18) revert InvalidDecimals(decimals_);
        if (answer_ <= 0) revert InvalidAnswer(answer_);
        owner = owner_;
        decimals = decimals_;
        description = description_;
        _pathSeed = keccak256(
            abi.encode(block.chainid, address(this), owner_, answer_, description_)
        );
        _setBaseAnswer(answer_);
    }

    /// @notice Optionally resets the synthetic path around a new baseline.
    /// @dev Routine freshness and price movement do not require this function to be called.
    function setAnswer(int256 answer_) external {
        if (msg.sender != owner) revert NotOwner();
        _setBaseAnswer(answer_);
    }

    function roundId() external view returns (uint80 roundId_) {
        (roundId_,,,,,) = _latestRoundData();
    }

    function answer() external view returns (int256 answer_) {
        (, answer_,,,,) = _latestRoundData();
    }

    function startedAt() external view returns (uint256 startedAt_) {
        (,, startedAt_,,,) = _latestRoundData();
    }

    function updatedAt() external view returns (uint256 updatedAt_) {
        (,,, updatedAt_,,) = _latestRoundData();
    }

    function answeredInRound() external view returns (uint80 answeredInRound_) {
        (,,,, answeredInRound_,) = _latestRoundData();
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
        (roundId_, answer_, startedAt_, updatedAt_, answeredInRound_,) = _latestRoundData();
        if (requestedRoundId != roundId_) revert RoundUnavailable(requestedRoundId);
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
        (roundId_, answer_, startedAt_, updatedAt_, answeredInRound_,) = _latestRoundData();
    }

    function _latestRoundData()
        private
        view
        returns (
            uint80 roundId_,
            int256 answer_,
            uint256 startedAt_,
            uint256 updatedAt_,
            uint80 answeredInRound_,
            uint256 priceEpoch
        )
    {
        uint256 timestamp = block.timestamp;
        uint256 elapsed = timestamp - baseTimestamp;
        priceEpoch = elapsed / PRICE_EPOCH;

        int256 movementBps;
        if (priceEpoch != 0) {
            uint256 driftBpsUnsigned = elapsed * DRIFT_BPS_PER_DAY / 1 days;
            if (driftBpsUnsigned > MAX_DRIFT_BPS) driftBpsUnsigned = MAX_DRIFT_BPS;
            // The value is capped at 90,000 immediately above, so this cast is safe.
            // forge-lint: disable-next-line(unsafe-typecast)
            int256 driftBps = int256(driftBpsUnsigned);
            uint256 noiseRange = VOLATILITY_BPS * 2 + 1;
            uint256 noiseUnsigned =
                uint256(keccak256(abi.encode(_pathSeed, priceEpoch))) % noiseRange;
            // The modulo result is at most 100, so this cast is safe.
            // forge-lint: disable-next-line(unsafe-typecast)
            int256 noiseBps = int256(noiseUnsigned) - VOLATILITY_BPS_INT;
            movementBps = driftBps + noiseBps;
        }

        int256 priceFactorBps = BPS_INT + movementBps;
        if (priceFactorBps < MIN_PRICE_FACTOR_BPS) {
            priceFactorBps = MIN_PRICE_FACTOR_BPS;
        } else if (priceFactorBps > MAX_PRICE_FACTOR_BPS) {
            priceFactorBps = MAX_PRICE_FACTOR_BPS;
        }
        answer_ = (baseAnswer * priceFactorBps) / BPS_INT;

        // Unix timestamps fit comfortably in uint80 for the lifetime of this test fixture.
        // forge-lint: disable-next-line(unsafe-typecast)
        roundId_ = uint80(timestamp);
        answeredInRound_ = roundId_;
        updatedAt_ = timestamp;

        // Add harmless timing texture without weakening freshness or allowing future timestamps.
        uint256 startLag = uint256(
            keccak256(abi.encode(_pathSeed, priceEpoch, timestamp, "start-lag"))
        ) % START_LAG_RANGE;
        startedAt_ = timestamp > startLag ? timestamp - startLag : timestamp;
    }

    function _setBaseAnswer(int256 answer_) private {
        if (answer_ <= 0) revert InvalidAnswer(answer_);
        baseAnswer = answer_;
        baseTimestamp = block.timestamp;
        // Unix timestamps fit comfortably in uint80 for the lifetime of this test fixture.
        // forge-lint: disable-next-line(unsafe-typecast)
        emit AnswerUpdated(answer_, uint80(block.timestamp), block.timestamp);
    }
}
