// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockStockToken } from "./MockStockToken.sol";

contract MockPaymentToken is MockStockToken {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        MockStockToken(name_, symbol_, decimals_)
    { }
}



