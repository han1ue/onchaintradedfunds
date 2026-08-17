import { describe, expect, it } from "vitest";
import { decodeErc20Text } from "./token-metadata";

function encodeString(value: string) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${"20".padStart(64, "0")}${(bytes.length / 2).toString(16).padStart(64, "0")}${padded}`;
}

describe("ERC-20 metadata decoding", () => {
  it("decodes ABI strings", () => {
    expect(decodeErc20Text(encodeString("Example Token"))).toBe("Example Token");
  });

  it("supports bytes32 metadata", () => {
    expect(decodeErc20Text(`0x${Buffer.from("TOKEN").toString("hex").padEnd(64, "0")}`)).toBe("TOKEN");
  });
});
