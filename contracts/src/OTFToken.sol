// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { OTFMetadata } from "./libraries/OTFMetadata.sol";

/// @notice Fixed-original-issuance, holder-burnable token for Onchain Traded Funds.
/// @dev MAX_SUPPLY records the one-time issuance; totalSupply is the live amount after burns.
contract OTFToken is ERC20Burnable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    error ZeroAddress();

    constructor(address initialHolder) ERC20("Onchain Traded Funds", "OTF") {
        if (initialHolder == address(0)) revert ZeroAddress();

        _mint(initialHolder, MAX_SUPPLY);
    }

    /// @notice ERC-1046 metadata containing the onchain OTF SVG.
    function tokenURI() external pure returns (string memory) {
        return OTFMetadata.protocolTokenURI();
    }
}
