import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeErc20Text, getTokenMetadata } from "./token-metadata";

function encodeString(value: string) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${"20".padStart(64, "0")}${(bytes.length / 2).toString(16).padStart(64, "0")}${padded}`;
}

describe("ERC-20 metadata decoding", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodes ABI strings", () => {
    expect(decodeErc20Text(encodeString("Example Token"))).toBe("Example Token");
  });

  it("supports bytes32 metadata", () => {
    expect(decodeErc20Text(`0x${Buffer.from("TOKEN").toString("hex").padEnd(64, "0")}`)).toBe("TOKEN");
  });

  it("requires the ERC-20 totalSupply interface before returning token identity", async () => {
    const results: Record<string, string> = {
      "0x06fdde03": encodeString("Example Token"),
      "0x95d89b41": encodeString("EXT"),
      "0x313ce567": `0x${(18).toString(16).padStart(64, "0")}`,
      "0x18160ddd": `0x${(1_000_000).toString(16).padStart(64, "0")}`,
    };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const data = JSON.parse(String(init?.body)) as { params: [{ data: string }] };
      return new Response(JSON.stringify({ result: results[data.params[0].data] }), { status: 200 });
    }));

    await expect(getTokenMetadata("0x0000000000000000000000000000000000000001", "https://rpc.test")).resolves.toEqual({
      name: "Example Token",
      symbol: "EXT",
      decimals: 18,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects contracts that do not implement totalSupply", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const data = JSON.parse(String(init?.body)) as { params: [{ data: string }] };
      const result = data.params[0].data === "0x18160ddd" ? "0x" : encodeString("Token");
      return new Response(JSON.stringify({ result }), { status: 200 });
    }));

    await expect(getTokenMetadata("0x0000000000000000000000000000000000000001", "https://rpc.test")).rejects.toThrow("TOKEN_METADATA_UNAVAILABLE");
  });
});
