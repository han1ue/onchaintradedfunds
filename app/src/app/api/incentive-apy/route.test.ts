import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readPrices } = vi.hoisted(() => ({ readPrices: vi.fn() }));

vi.mock("@/server/pricing",()=>({readPrices}));
vi.mock("@/lib/chains", () => ({
  robinhoodChain: { id: 4663, rpcUrls: { default: { http: ["http://localhost:8546"] } } },
  robinhoodChainTestnet: { id: 46630, rpcUrls: { default: { http: ["http://localhost:8545"] } } },
}));
vi.mock("@/lib/deployment", () => ({
  protocolDeploymentForChain: (chainId: number) => [4663, 46630].includes(chainId) ? {
    addresses: { otfToken:"0x0000000000000000000000000000000000000009", launchManager: chainId === 4663 ? "0x0000000000000000000000000000000000000002" : "0x0000000000000000000000000000000000000001" },
    rewardsDeployedAtMs: Date.parse("2026-09-04T00:00:00Z"),
  } : undefined,
}));
vi.mock("@/lib/incentive-apy", () => import("../../../lib/incentive-apy"));

import { GET } from "./route";

describe("incentive pricing", () => {
  it("reads shared mainnet prices when mainnet is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ethereum: { usd: 2000 } })));
    const response = await GET(new Request("http://localhost/api/incentive-apy?chainId=4663"));
    expect(response.status).toBe(200);
    expect(readPrices).toHaveBeenCalledWith(4663);
  });
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-06T00:00:00Z"));
    readPrices.mockResolvedValue([{address:"0x0000000000000000000000000000000000000009",priceUsd:"2",priceUpdatedAt:"2026-09-06T00:00:00Z",quality:"fresh",usable:true}]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    readPrices.mockReset();
  });

  it("returns one shared dollar price with the weekly distribution", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ethereum: { usd: 2000 } })));
    const response = await GET(new Request("http://localhost/api/incentive-apy?chainId=46630&includePrice=true"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ week: 1, weeklyEmissionOtf: 14_000_000, otfPriceUsd: 2 });
    expect(readPrices).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the weekly distribution available when dollar pricing fails", async () => {
    readPrices.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    const response = await GET(new Request("http://localhost/api/incentive-apy?chainId=46630&includePrice=true"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ week: 1, weeklyEmissionOtf: 14_000_000, weeklyDepositorEmissionOtf: 13_000_000 });
    expect(payload).not.toHaveProperty("otfPriceUsd");
  });
});
