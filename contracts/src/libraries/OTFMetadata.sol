// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice Canonical fully onchain metadata for the protocol token and OTF vault shares.
library OTFMetadata {
    string internal constant SQUARE_ICON_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="7" y="7" width="242" height="242" fill="#090909" stroke="#ccff00" stroke-width="12"/><text x="128" y="156" fill="#ccff00" font-family="Instrument Sans,Arial,sans-serif" font-size="76" font-weight="700" letter-spacing="-2" text-anchor="middle">OTF</text></svg>';

    function protocolTokenURI() internal pure returns (string memory) {
        return _tokenURI(
            "Onchain Traded Funds", "The fixed-supply protocol token of Onchain Traded Funds."
        );
    }

    function shareTokenURI() internal pure returns (string memory) {
        return _tokenURI(
            "Onchain Traded Fund Share", "A share token issued by an Onchain Traded Funds vault."
        );
    }

    function _tokenURI(string memory tokenName, string memory description)
        private
        pure
        returns (string memory)
    {
        string memory image = string.concat(
            "data:image/svg+xml;base64,", Base64.encode(bytes(SQUARE_ICON_SVG))
        );
        string memory json = string.concat(
            '{"name":"',
            tokenName,
            '","symbol":"OTF","interop":{"erc1046":true},"description":"',
            description,
            '","image":"',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
