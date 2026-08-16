// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20Base } from "./ERC20Base.sol";

/// @notice Fixed-supply protocol token for Onchain Traded Funds.
/// @dev Distribution and governance can be layered around this token without introducing a
///      privileged minting key into the token itself.
contract OTFToken is ERC20Base {
    error ZeroAddress();
    error ZeroInitialSupply();

    constructor(address initialHolder, uint256 initialSupply) {
        if (initialHolder == address(0)) revert ZeroAddress();
        if (initialSupply == 0) revert ZeroInitialSupply();

        _initializeERC20("Onchain Traded Funds", "OTF", 18);
        _mint(initialHolder, initialSupply);
    }
}
