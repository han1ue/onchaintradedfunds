import { concatHex, type Hex } from "viem";

export const V3_POOL_INIT_CODE_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54" as const;

/** Version discriminator for the bounded OTF Universal Router adapter. */
export function universalRouteData(version: 3 | 4, path: Hex): Hex {
  return concatHex([version === 3 ? "0x03" : "0x04", path]);
}

export function decodeUniversalRouteData(data: Hex): { version: 3 | 4; path: Hex } {
  const prefix = data.slice(0, 4);
  if (prefix !== "0x03" && prefix !== "0x04") throw new Error("Unsupported Uniswap adapter route.");
  return { version: prefix === "0x03" ? 3 : 4, path: `0x${data.slice(4)}` };
}
