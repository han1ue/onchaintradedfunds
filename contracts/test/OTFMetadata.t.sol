// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { OTFMetadata } from "../src/libraries/OTFMetadata.sol";

contract MetadataHarness {
    function share(string memory ticker) external pure returns (string memory) {
        return OTFMetadata.shareTokenURI("Example OTF", ticker);
    }
}

contract OTFMetadataTest is Test {
    MetadataHarness internal renderer = new MetadataHarness();

    function testShortTickerKeepsNaturalWidth() public view {
        string memory svg = _svg(renderer.share("AI"));
        assertTrue(_contains(svg, 'font-size="76"'));
        assertTrue(_contains(svg, ">AI</text>"));
        assertFalse(_contains(svg, "textLength="));
        assertFalse(_contains(svg, 'y="116.5"'));
    }

    function testFourAndFiveLettersShareTheSameSideSpacing() public view {
        assertTrue(_contains(_svg(renderer.share("TECH")), 'textLength="172"'));
        assertTrue(_contains(_svg(renderer.share("TECH")), 'y="149.5"'));
        string memory svg = _svg(renderer.share("MCAP5"));
        assertTrue(_contains(svg, 'textLength="172"'));
        assertTrue(_contains(svg, 'y="145"'));
        assertTrue(_contains(svg, ">MCAP5</text>"));
        assertFalse(_contains(svg, 'y="116.5"'));
    }

    function testLongTickersUseBalancedRows() public view {
        string[3] memory tickers = ["ABCDEF", "ABCDEFG", "ABCDEFGH"];
        string[3] memory first = ["ABC", "ABCD", "ABCD"];
        string[3] memory second = ["DEF", "EFG", "EFGH"];
        for (uint256 i = 0; i < tickers.length; i++) {
            string memory svg = _svg(renderer.share(tickers[i]));
            assertTrue(_contains(svg, 'y="116.5"'));
            assertTrue(_contains(svg, 'y="182.5"'));
            assertTrue(_contains(svg, string.concat(">", first[i], "</text>")));
            assertTrue(_contains(svg, string.concat(">", second[i], "</text>")));
            assertFalse(_contains(svg, 'y="156"'));
        }
    }

    function testImageUppercaseDoesNotChangeMetadataSymbol() public view {
        string memory uri = renderer.share("aBcDeF");
        string memory json = _decode(uri, "data:application/json;base64,");
        assertEq(vm.parseJsonString(json, ".symbol"), "aBcDeF");
        assertTrue(_contains(_svg(uri), ">ABC</text>"));
        assertTrue(_contains(_svg(uri), ">DEF</text>"));
    }

    function testShareMetadataFollowsErc1046IdentityAndInterop() public pure {
        string memory uri = OTFMetadata.shareTokenURI("Balanced Growth OTF", "bAlAnCe");
        string memory json = _decode(uri, "data:application/json;base64,");
        assertEq(vm.parseJsonString(json, ".name"), "Balanced Growth OTF");
        assertEq(vm.parseJsonString(json, ".symbol"), "bAlAnCe");
        assertTrue(vm.parseJsonBool(json, ".interop.erc1046"));
        assertFalse(_contains(json, '"decimals"'));
    }

    function testShareNameRoundTripsQuotesBackslashesAndUnicode() public pure {
        string memory tokenName = unicode'Growth "A" \\ Café OTF';
        string memory uri = OTFMetadata.shareTokenURI(tokenName, "GROWTH");
        string memory json = _decode(uri, "data:application/json;base64,");
        assertEq(vm.parseJsonString(json, ".name"), tokenName);
    }

    function testInvalidTickerBoundariesAreRejected() public {
        vm.expectRevert(OTFMetadata.InvalidTicker.selector);
        renderer.share("");
        vm.expectRevert(OTFMetadata.InvalidTicker.selector);
        renderer.share("ABCDEFGHI");
        vm.expectRevert(OTFMetadata.InvalidTicker.selector);
        renderer.share("A B");
    }

    function testProtocolMetadataUsesTheCircularCoinMark() public view {
        string memory uri = OTFMetadata.protocolTokenURI();
        string memory json = _decode(uri, "data:application/json;base64,");
        assertEq(vm.parseJsonString(json, ".name"), "Onchain Traded Funds");
        assertTrue(vm.parseJsonBool(json, ".interop.erc1046"));
        assertEq(
            vm.parseJsonString(_decode(uri, "data:application/json;base64,"), ".symbol"), "OTF"
        );
        string memory svg = _svg(uri);
        assertTrue(_contains(svg, 'viewBox="0 0 1024 1024"'));
        assertTrue(_contains(svg, '<circle cx="512" cy="512" r="470"'));
        assertTrue(_contains(svg, 'stroke-width="40"'));
        assertTrue(_contains(svg, '<text x="512" y="620"'));
        assertTrue(_contains(svg, 'font-size="300"'));
        assertTrue(_contains(svg, 'letter-spacing="24"'));
        assertTrue(_contains(svg, ">OTF</text>"));
        assertFalse(_contains(svg, "<rect"));
    }

    function _svg(string memory uri) private view returns (string memory) {
        string memory json = _decode(uri, "data:application/json;base64,");
        return _decode(vm.parseJsonString(json, ".image"), "data:image/svg+xml;base64,");
    }

    function _decode(string memory uri, string memory prefix) private pure returns (string memory) {
        bytes memory data = bytes(uri);
        bytes memory encoded = new bytes(data.length - bytes(prefix).length);
        for (uint256 i = 0; i < bytes(prefix).length; i++) {
            assertEq(data[i], bytes(prefix)[i]);
        }
        for (uint256 i = 0; i < encoded.length; i++) {
            encoded[i] = data[i + bytes(prefix).length];
        }
        return string(Base64.decode(string(encoded)));
    }

    function _contains(string memory text, string memory fragment) private pure returns (bool) {
        bytes memory data = bytes(text);
        bytes memory needle = bytes(fragment);
        for (uint256 i = 0; i + needle.length <= data.length; i++) {
            bool matchFound = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (data[i + j] != needle[j]) {
                    matchFound = false;
                    break;
                }
            }
            if (matchFound) return true;
        }
        return false;
    }
}
