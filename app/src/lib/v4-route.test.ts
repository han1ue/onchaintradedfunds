import { encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { encodeV4Path, parseV4Path, v4PoolId, type V4PathKey } from "./v4-route";
const A = "0x0000000000000000000000000000000000000001" as Address;
const B = "0x0000000000000000000000000000000000000002" as Address;
const C = "0x0000000000000000000000000000000000000003" as Address;
const hop: V4PathKey = { intermediateCurrency: B, fee: 3000, tickSpacing: 60, hooks: zeroAddress, hookData: "0x" };
describe("V4 adapter paths", () => {
  it("encodes Solidity PathKey arrays and derives pool IDs independent of direction", () => {
    expect(parseV4Path(encodeV4Path([hop, { ...hop, intermediateCurrency: C, fee: 0x800000, hookData: "0x1234" }]), A)).toEqual([
      { venue: "Uniswap V4", tokenIn: A, tokenOut: B, feeTier: 3000 },
      { venue: "Uniswap V4", tokenIn: B, tokenOut: C, feeTier: 0x800000 },
    ]);
    const id = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [A, B, 3000, 60, zeroAddress]));
    expect(v4PoolId(A, hop)).toBe(id);
    expect(v4PoolId(B, { ...hop, intermediateCurrency: A })).toBe(id);
  });
  it.each([
    { intermediateCurrency: zeroAddress }, { intermediateCurrency: A }, { fee: 1000001 }, { tickSpacing: 0 }, { tickSpacing: -1 }, { tickSpacing: 32768 },
    { hookData: `0x${"ab".repeat(1025)}` as const },
  ])("rejects hops outside the adapter's supported format: %j", (override) => {
    expect(() => parseV4Path(encodeV4Path([{ ...hop, ...override }]), A)).toThrow();
  });
  it("rejects oversized paths and noncanonical trailing data", () => {
    expect(() => parseV4Path(encodeV4Path([hop, hop, hop, hop]), A)).toThrow();
    expect(() => parseV4Path(`${encodeV4Path([hop])}00`, A)).toThrow();
  });
});
