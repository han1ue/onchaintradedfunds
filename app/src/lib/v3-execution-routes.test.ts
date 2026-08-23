import { describe, expect, it } from "vitest";
import { selectExecutionRoute, selectV3Pool, type DiscoveredV3Pool } from "./v3-execution-routes";

const ASSET = "0x0000000000000000000000000000000000000001";
const USDG = "0x0000000000000000000000000000000000000002";
const WETH = "0x0000000000000000000000000000000000000003";

function pool(
  address: string,
  tokenA: string,
  tokenB: string,
  fee: number,
  liquidity: bigint,
): DiscoveredV3Pool {
  return { address, tokenA, tokenB, fee, liquidity, readFailed: false } as DiscoveredV3Pool;
}

describe("dynamic V3 execution routes", () => {
  it("selects the most liquid fee tier for a pair", () => {
    const pools = [
      pool("0x0000000000000000000000000000000000000010", ASSET, USDG, 500, 10n),
      pool("0x0000000000000000000000000000000000000011", USDG, ASSET, 3_000, 20n),
    ];
    expect(selectV3Pool(pools, ASSET, USDG)?.fee).toBe(3_000);
  });

  it("prefers a live direct pool", () => {
    const direct = pool("0x0000000000000000000000000000000000000010", ASSET, USDG, 500, 10n);
    const route = selectExecutionRoute([direct], ASSET, USDG, WETH);
    expect(route?.assetPool.address).toBe(direct.address);
    expect(route?.bridgePool).toBeUndefined();
  });

  it("uses an alternate quote and discovered bridge when the direct pool has no liquidity", () => {
    const direct = pool("0x0000000000000000000000000000000000000010", ASSET, USDG, 500, 0n);
    const assetWeth = pool("0x0000000000000000000000000000000000000011", ASSET, WETH, 3_000, 15n);
    const bridge = pool("0x0000000000000000000000000000000000000012", WETH, USDG, 100, 30n);
    const route = selectExecutionRoute([direct, assetWeth, bridge], ASSET, USDG, WETH);
    expect(route?.assetPool.address).toBe(assetWeth.address);
    expect(route?.bridgePool?.address).toBe(bridge.address);
  });
});
