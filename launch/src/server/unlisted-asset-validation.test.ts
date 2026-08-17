import { afterEach, describe, expect, it, vi } from "vitest";

const asset = "0x1111111111111111111111111111111111111111";
const pool = "0x2222222222222222222222222222222222222222";
const factory = "0x3333333333333333333333333333333333333333";
const weth = "0x4444444444444444444444444444444444444444";
const usdg = "0x5555555555555555555555555555555555555555";

function word(value: number | bigint) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function dynamicText(value: string) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  return `0x${word(32)}${word(bytes.length / 2)}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ["ROBINHOOD_V3_FACTORY_ADDRESS", "ROBINHOOD_WETH_ADDRESS", "ROBINHOOD_USDG_ADDRESS", "ROBINHOOD_V3_SUPPORTED_FEES", "ROBINHOOD_RPC_URL", "COINGECKO_NETWORK_ID"]) delete process.env[key];
});

describe("unlisted asset validation", () => {
  it("validates the token first, then the pool, and reuses the 30-minute cache", async () => {
    process.env.ROBINHOOD_V3_FACTORY_ADDRESS = factory;
    process.env.ROBINHOOD_WETH_ADDRESS = weth;
    process.env.ROBINHOOD_USDG_ADDRESS = usdg;
    process.env.ROBINHOOD_V3_SUPPORTED_FEES = "3000";
    process.env.ROBINHOOD_RPC_URL = "https://rpc.test";
    process.env.COINGECKO_NETWORK_ID = "robinhood-mainnet";
    vi.resetModules();

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://rpc.test") {
        const body = JSON.parse(String(init?.body)) as { params: [{ to: string; data: string }] };
        const to = body.params[0].to.toLowerCase();
        const data = body.params[0].data.toLowerCase();
        const selector = data.slice(0, 10);
        const result = to === asset && selector === "0x06fdde03" ? dynamicText("Example Token")
          : to === asset && selector === "0x95d89b41" ? dynamicText("EXAMPLE")
            : to === asset && selector === "0x313ce567" ? `0x${word(18)}`
              : to === asset && selector === "0x18160ddd" ? `0x${word(1_000_000)}`
                : to === pool && selector === "0xc45a0155" ? `0x${encodeAddress(factory)}`
                  : to === pool && selector === "0x0dfe1681" ? `0x${encodeAddress(asset)}`
                    : to === pool && selector === "0xd21220a7" ? `0x${encodeAddress(weth)}`
                      : to === pool && selector === "0xddca3f43" ? `0x${word(3000)}`
                        : to === pool && selector === "0x3850c7bd" ? `0x${word(1)}${word(0)}${word(0)}${word(64)}${word(64)}${word(0)}${word(1)}`
                          : to === pool && selector === "0x1a686502" ? `0x${word(1000)}`
                            : to === factory && selector === "0x1698ee82" ? `0x${encodeAddress(pool)}`
                              : to === factory && selector === "0x22afcccb" ? `0x${word(60)}`
                                : to === pool && selector === "0x883bdbfd" ? `0x${word(64)}`
                                  : null;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      }
      if (url.includes("/pools/")) return new Response(JSON.stringify({ data: { attributes: { reserve_in_usd: "50000", locked_liquidity_percentage: "75", pool_created_at: "2026-08-01T00:00:00Z" } } }));
      if (url.includes("/tokens/") && url.endsWith("/info")) return new Response(JSON.stringify({ data: { attributes: { gt_score: 80, gt_verified: true, is_honeypot: false } } }));
      return new Response(JSON.stringify({ data: { attributes: { market_cap_usd: "200000" } } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { validateUnlistedAsset } = await import("./unlisted-asset-validation");
      const tokenResult = await validateUnlistedAsset({ assetAddress: asset, competitionStartsAt: new Date("2026-08-17T00:00:00Z") });
      expect(tokenResult.asset).toMatchObject({ address: asset, decimals: 18 });
      expect(tokenResult.market.poolAddress).toBeNull();
      expect(tokenResult.status).toBe("pending");
      expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith("https://api.geckoterminal.com/")).length).toBe(2);

      const result = await validateUnlistedAsset({ assetAddress: asset, poolAddress: pool, competitionStartsAt: new Date("2026-08-17T00:00:00Z") });
      expect(result.status).toBe("pass");
      expect(result.requirements.every((item) => item.status === "pass")).toBe(true);
      expect(result.marketDetails).toMatchObject({ factoryAddress: factory, quoteTokenAddress: weth, feeTier: 3000 });
      const callsAfterFullValidation = fetchMock.mock.calls.length;
      await validateUnlistedAsset({ assetAddress: asset, poolAddress: pool, competitionStartsAt: new Date("2026-08-17T00:00:00Z") });
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterFullValidation);
      const calls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(calls.findIndex((url) => url.includes("/pools/"))).toBeGreaterThan(calls.filter((url) => url === "https://rpc.test").length - 1);
      expect(calls.filter((url) => url.startsWith("https://api.geckoterminal.com/")).length).toBe(3);
    } finally {
      vi.resetModules();
    }
  }, 15_000);
});

function encodeAddress(address: string) {
  return address.replace(/^0x/, "").padStart(64, "0");
}
