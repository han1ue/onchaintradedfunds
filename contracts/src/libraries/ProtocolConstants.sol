// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ProtocolConstants {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant MIN_CONSTITUENTS = 2;
    uint256 internal constant MAX_CONSTITUENTS = 20;
    uint256 internal constant MAX_SWAP_HOPS = 3;
    uint256 internal constant MAX_OTF_NAME_BYTES = 50;
    uint256 internal constant MAX_FUND_THESIS_BYTES = 2_048;
    uint16 internal constant MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS = 1_000;
    uint16 internal constant MAX_MINT_FEE_BPS = 200;
    uint16 internal constant MAX_REDEEM_FEE_BPS = 100;
    uint256 internal constant OTF_FEE_BENEFIT_CAP = 10_000_000 ether;
    uint256 internal constant MINIMUM_SHARE_SUPPLY = 1e16;
    bytes1 internal constant UNISWAP_V4_SWAP_COMMAND = 0x10;
    bytes1 internal constant UNISWAP_V4_SWAP_EXACT_IN_ACTION = 0x07;
    bytes1 internal constant UNISWAP_V4_SETTLE_ALL_ACTION = 0x0c;
    bytes1 internal constant UNISWAP_V4_TAKE_ALL_ACTION = 0x0f;
}
