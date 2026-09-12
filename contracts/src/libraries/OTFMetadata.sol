// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Canonical fully onchain metadata for the protocol token and OTF vault shares.
library OTFMetadata {
    error InvalidTicker();

    string internal constant COIN_ICON_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="470" fill="#090909" stroke="#ccff00" stroke-width="40"/><text x="512" y="620" fill="#ccff00" font-family="Instrument Sans,Arial,sans-serif" font-size="300" font-weight="700" letter-spacing="24" text-anchor="middle">OTF</text></svg>';

    function protocolTokenURI() internal pure returns (string memory) {
        return _tokenURI(
            "Onchain Traded Funds",
            "OTF",
            "The fixed-supply protocol token of Onchain Traded Funds.",
            COIN_ICON_SVG
        );
    }

    function shareTokenURI(string memory tokenName, string memory ticker)
        internal
        pure
        returns (string memory)
    {
        return _tokenURI(
            tokenName,
            ticker,
            "A share token issued by an Onchain Traded Funds vault.",
            _shareIcon(ticker)
        );
    }

    function _shareIcon(string memory ticker) private pure returns (string memory) {
        bytes memory label = abi.encodePacked(ticker);
        if (label.length == 0 || label.length > 8) revert InvalidTicker();
        for (uint256 i = 0; i < label.length; i++) {
            uint8 character = uint8(label[i]);
            if (character >= 97 && character <= 122) {
                label[i] = bytes1(character - 32);
            } else if (
                !(character >= 65 && character <= 90) && !(character >= 48 && character <= 57)
            ) {
                revert InvalidTicker();
            }
        }
        string memory text;
        if (label.length <= 5) {
            string memory fontSize = label.length <= 3 ? "76" : label.length == 4 ? "60" : "48";
            string memory baseline = label.length <= 3 ? "156" : label.length == 4 ? "149.5" : "145";
            text = _text(string(label), baseline, fontSize);
        } else {
            uint256 splitAt = (label.length + 1) / 2;
            bytes memory first = new bytes(splitAt);
            bytes memory second = new bytes(label.length - splitAt);
            for (uint256 i = 0; i < label.length; i++) {
                if (i < splitAt) first[i] = label[i];
                else second[i - splitAt] = label[i];
            }
            text = string.concat(
                _text(string(first), "116.5", "60"), _text(string(second), "182.5", "60")
            );
        }
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="9" y="9" width="238" height="238" fill="#090909" stroke="#ccff00" stroke-width="16"/>',
            text,
            "</svg>"
        );
    }

    function _text(string memory label, string memory y, string memory fontSize)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<text x="128" y="',
            y,
            '" fill="#ccff00" font-family="Instrument Sans,Arial,sans-serif" font-size="',
            fontSize,
            '" font-weight="700" letter-spacing="-2" text-anchor="middle"',
            bytes(label).length >= 4 ? ' textLength="172" lengthAdjust="spacingAndGlyphs"' : "",
            ">",
            label,
            "</text>"
        );
    }

    function _tokenURI(
        string memory tokenName,
        string memory tokenSymbol,
        string memory description,
        string memory iconSvg
    ) private pure returns (string memory) {
        string memory image = string.concat(
            "data:image/svg+xml;base64,", Base64.encode(bytes(iconSvg))
        );
        string memory json = string.concat(
            '{"name":"',
            Strings.escapeJSON(tokenName),
            '","symbol":"',
            tokenSymbol,
            '","interop":{"erc1046":true},"description":"',
            description,
            '","image":"',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
