import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCron: vi.fn(),
  captureAssetPrices: vi.fn(),
  captureMarketEvidence: vi.fn(),
}));

vi.mock("@/server/cron", () => ({ assertCron: mocks.assertCron }));
vi.mock("@/server/prices", () => ({ captureAssetPrices: mocks.captureAssetPrices }));
vi.mock("@/server/market-evidence", () => ({ captureMarketEvidence: mocks.captureMarketEvidence }));

import { GET } from "./route";

describe("30-minute price job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureAssetPrices.mockResolvedValue({ stored: 46, complete: true });
    mocks.captureMarketEvidence.mockResolvedValue({ markets: [] });
  });

  it("stores scoring prices and market evidence", async () => {
    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.assertCron).toHaveBeenCalledOnce();
    expect(mocks.captureAssetPrices).toHaveBeenCalledWith({ purpose: "scoring" });
    expect(mocks.captureMarketEvidence).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { prices: { stored: 46 } } });
  });
});
