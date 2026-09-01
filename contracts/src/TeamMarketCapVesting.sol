// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IUniswapV4StateView } from "./interfaces/IUniswapV4.sol";
import { SafeTransferLib } from "./libraries/SafeTransferLib.sol";
import { V4PriceMath } from "./libraries/V4PriceMath.sol";

interface IOTFLaunchPriceSource {
    function otf() external view returns (address);
    function stateView() external view returns (address);
    function poolId() external view returns (bytes32);
    function otfIsCurrency0() external view returns (bool);
}

/// @notice Irreversible 10m OTF team unlocks at each completed $1m live-FDV milestone.
contract TeamMarketCapVesting {
    using SafeTransferLib for address;

    uint256 public constant TEAM_ALLOCATION = 100_000_000 ether;
    uint256 public constant FDV_MILESTONE_USD_WAD = 1_000_000 ether;
    uint256 public constant TRANCHE_SIZE = 10_000_000 ether;
    uint256 public constant MILESTONE_COUNT = 10;

    error ZeroAddress();
    error InvalidDependency(address dependency);
    error InvalidOracleAnswer(int256 answer);
    error InvalidOracleTimestamp(uint256 updatedAt);
    error StaleOracle(uint256 updatedAt, uint256 maximumAge);
    error InvalidOracleDecimals(uint8 decimals);
    error NotBeneficiary(address caller);
    error NothingToClaim();

    event VestingCheckpointed(uint256 liveFdvUsdWad, uint256 cumulativeUnlocked);
    event Claimed(address indexed beneficiary, uint256 amount, uint256 cumulativeClaimed);

    address public immutable otf;
    address public immutable stateView;
    bytes32 public immutable poolId;
    bool public immutable otfIsCurrency0;
    AggregatorV3Interface public immutable ethUsdOracle;
    uint256 public immutable maxOracleAge;
    address public immutable beneficiary;

    uint256 public unlockedAmount;
    uint256 public claimedAmount;

    constructor(
        address launchManager,
        address ethUsdOracle_,
        uint256 maxOracleAge_,
        address beneficiary_
    ) {
        _requireContract(launchManager);
        _requireContract(ethUsdOracle_);
        if (beneficiary_ == address(0)) revert ZeroAddress();
        if (maxOracleAge_ == 0) revert StaleOracle(0, 0);

        IOTFLaunchPriceSource launch = IOTFLaunchPriceSource(launchManager);
        address otf_ = launch.otf();
        address stateView_ = launch.stateView();
        _requireContract(otf_);
        _requireContract(stateView_);
        uint8 oracleDecimals = AggregatorV3Interface(ethUsdOracle_).decimals();
        if (oracleDecimals > 18) revert InvalidOracleDecimals(oracleDecimals);

        otf = otf_;
        stateView = stateView_;
        poolId = launch.poolId();
        otfIsCurrency0 = launch.otfIsCurrency0();
        ethUsdOracle = AggregatorV3Interface(ethUsdOracle_);
        maxOracleAge = maxOracleAge_;
        beneficiary = beneficiary_;
    }

    function currentOtfPriceWethWad() public view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = IUniswapV4StateView(stateView).getSlot0(poolId);
        return V4PriceMath.otfPriceWethWad(sqrtPriceX96, otfIsCurrency0);
    }

    function oracleStatus()
        public
        view
        returns (uint256 ethUsdPriceWad, uint256 updatedAt, uint256 updateAge)
    {
        (, int256 answer,, uint256 oracleUpdatedAt,) = ethUsdOracle.latestRoundData();
        updatedAt = oracleUpdatedAt;
        if (answer <= 0) revert InvalidOracleAnswer(answer);
        // Oracle freshness is intentionally evaluated against the current block timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (updatedAt == 0 || updatedAt > block.timestamp) {
            revert InvalidOracleTimestamp(updatedAt);
        }
        updateAge = block.timestamp - updatedAt;
        if (updateAge > maxOracleAge) revert StaleOracle(updatedAt, maxOracleAge);
        uint8 oracleDecimals = ethUsdOracle.decimals();
        // answer is proven positive above.
        // forge-lint: disable-next-line(unsafe-typecast)
        ethUsdPriceWad = uint256(answer) * (10 ** (18 - oracleDecimals));
    }

    function liveFdvUsdWad() public view returns (uint256) {
        (uint256 ethUsdPriceWad,,) = oracleStatus();
        uint256 marketValueWeth =
            Math.mulDiv(currentOtfPriceWethWad(), IERC20(otf).totalSupply(), 1e18);
        return Math.mulDiv(marketValueWeth, ethUsdPriceWad, 1e18);
    }

    function checkpoint() external returns (uint256 cumulativeUnlocked) {
        uint256 liveFdv = liveFdvUsdWad();
        uint256 milestones = liveFdv / FDV_MILESTONE_USD_WAD;
        if (milestones > MILESTONE_COUNT) milestones = MILESTONE_COUNT;
        cumulativeUnlocked = milestones * TRANCHE_SIZE;
        if (cumulativeUnlocked > unlockedAmount) unlockedAmount = cumulativeUnlocked;
        emit VestingCheckpointed(liveFdv, unlockedAmount);
        return unlockedAmount;
    }

    function claimable() public view returns (uint256) {
        return unlockedAmount - claimedAmount;
    }

    function claim() external returns (uint256 amount) {
        if (msg.sender != beneficiary) revert NotBeneficiary(msg.sender);
        amount = claimable();
        if (amount == 0) revert NothingToClaim();
        claimedAmount += amount;
        otf.safeTransfer(beneficiary, amount);
        emit Claimed(beneficiary, amount, claimedAmount);
    }

    function nextMilestone()
        external
        view
        returns (uint256 fdvUsdWad, uint256 additionalUnlock, uint256 progressWad)
    {
        uint256 completed = unlockedAmount / TRANCHE_SIZE;
        if (completed >= MILESTONE_COUNT) return (0, 0, 1e18);
        fdvUsdWad = (completed + 1) * FDV_MILESTONE_USD_WAD;
        additionalUnlock = TRANCHE_SIZE;
        uint256 currentFdv = liveFdvUsdWad();
        uint256 previousFdv = completed * FDV_MILESTONE_USD_WAD;
        if (currentFdv <= previousFdv) return (fdvUsdWad, additionalUnlock, 0);
        progressWad = Math.mulDiv(currentFdv - previousFdv, 1e18, FDV_MILESTONE_USD_WAD);
        if (progressWad > 1e18) progressWad = 1e18;
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0)) revert ZeroAddress();
        if (dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
