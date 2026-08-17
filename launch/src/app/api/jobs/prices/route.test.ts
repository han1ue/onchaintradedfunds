import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCron: vi.fn(),
  captureAssetPrices: vi.fn(),
  captureMarketEvidence: vi.fn(),
  currentCompetition: vi.fn(),
}));

vi.mock("@/server/cron", () => ({ assertCron: mocks.assertCron }));
vi.mock("@/server/prices", () => ({ captureAssetPrices: mocks.captureAssetPrices }));
vi.mock("@/server/market-evidence", () => ({ captureMarketEvidence: mocks.captureMarketEvidence }));
vi.mock("@/server/guards", () => ({ currentCompetition: mocks.currentCompetition }));

import { GET } from "./route";

describe("30-minute price job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentCompetition.mockResolvedValue({ id: "competition-1" });
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

  it("does not capture prices or market evidence after the competition closes", async () => {
    mocks.currentCompetition.mockRejectedValueOnce(new Error("COMPETITION_NOT_OPEN"));

    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.captureAssetPrices).not.toHaveBeenCalled();
    expect(mocks.captureMarketEvidence).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { active: false, prices: null, markets: null } });
  });
});
