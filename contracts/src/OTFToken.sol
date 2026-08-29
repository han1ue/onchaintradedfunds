// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply protocol token for Onchain Traded Funds.
/// @dev Distribution and governance can be layered around this token without introducing a
///      privileged minting key into the token itself.
contract OTFToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    string private constant OTF_TOKEN_METADATA_URI = "data:application/json;base64,eyJuYW1lIjoiT25jaGFpbiBUcmFkZWQgRnVuZHMiLCJzeW1ib2wiOiJPVEYiLCJpbnRlcm9"
        "wIjp7ImVyYzEwNDYiOnRydWV9LCJkZXNjcmlwdGlvbiI6IlRoZSBmaXhlZC1zdXBwbHkgcHJvdG9jb2wgdG9rZW4gb2YgT25jaGF"
        "pbiBUcmFkZWQgRnVuZHMuIiwiaW1hZ2UiOiJkYXRhOmltYWdlL3N2Zyt4bWw7YmFzZTY0LFBITjJaeUI0Yld4dWN6MGlhSFIwY0R"
        "vdkwzZDNkeTUzTXk1dmNtY3ZNakF3TUM5emRtY2lJSFpwWlhkQ2IzZzlJakFnTUNBeU5UWWdNalUySWo0OGNtVmpkQ0I0UFNJM0l"
        "pQjVQU0kzSWlCM2FXUjBhRDBpTWpReUlpQm9aV2xuYUhROUlqSTBNaUlnY25nOUlqUTBJaUJtYVd4c1BTSWpNVE15TmpJMUlpQnp"
        "kSEp2YTJVOUlpTXpOMkkzWVdFaUlITjBjbTlyWlMxdmNHRmphWFI1UFNJdU5qZ2lJSE4wY205clpTMTNhV1IwYUQwaU5TSXZQanh"
        "3WVhSb0lHWnBiR3c5SWlNM1ltUTRZMlVpSUdacGJHd3RjblZzWlQwaVpYWmxibTlrWkNJZ1pEMGlUVE01SURneWFEWXdkamt5U0R"
        "NNVZqZ3lXbTB4TnlBeE4zWTFPR2d5TmxZNU9VZzFObG9pTHo0OGNHRjBhQ0JtYVd4c1BTSWpOMkprT0dObElpQmtQU0pOTVRBMkl"
        "EZ3lhRFUzZGpFM2FDMHlNSFkzTldndE1UZFdPVGxvTFRJd1ZqZ3lXbTAyTkNBd2FEUTVkakUzYUMwek1uWXlNV2d5T0hZeE4yZ3R"
        "NamgyTXpkb0xURTNWamd5V2lJdlBqd3ZjM1puUGc9PSJ9";

    error ZeroAddress();

    constructor(address initialHolder) ERC20("Onchain Traded Funds", "OTF") {
        if (initialHolder == address(0)) revert ZeroAddress();

        _mint(initialHolder, MAX_SUPPLY);
    }

    /// @notice ERC-1046 metadata containing the onchain OTF SVG.
    function tokenURI() external pure returns (string memory) {
        return OTF_TOKEN_METADATA_URI;
    }
}
