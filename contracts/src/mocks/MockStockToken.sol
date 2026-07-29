// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "../ERC20Base.sol";

contract MockStockToken is ERC20Base {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        _initializeERC20(name_, symbol_, decimals_);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

