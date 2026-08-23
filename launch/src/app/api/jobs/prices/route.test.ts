import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCron: vi.fn(),
  captureAssetPrices: vi.fn(),
  priceCapturePurpose: vi.fn(),
}));

vi.mock("@/server/cron", () => ({ assertCron: mocks.assertCron }));
vi.mock("@/server/prices", () => ({ captureAssetPrices: mocks.captureAssetPrices }));
vi.mock("@/server/guards", () => ({ priceCapturePurpose: mocks.priceCapturePurpose }));

import { GET } from "./route";

describe("30-minute price job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.priceCapturePurpose.mockResolvedValue("scoring");
    mocks.captureAssetPrices.mockResolvedValue({ stored: 46, status: "complete", missingAssets: [], ambiguousAssets: [] });
  });

  it("stores scoring prices without capturing market evidence", async () => {
    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.assertCron).toHaveBeenCalledOnce();
    expect(mocks.captureAssetPrices).toHaveBeenCalledWith({ purpose: "scoring" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { prices: { stored: 46, status: "complete" } } });
  });

  it("does not capture before opening, after the competition ends, or after cancellation", async () => {
    mocks.priceCapturePurpose.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.captureAssetPrices).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ data: { active: false, purpose: null, prices: null } });
  });

  it("returns HTTP 200 with explicit partial status and missing assets", async () => {
    mocks.captureAssetPrices.mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
      sampledAt: new Date("2026-08-23T12:00:00.000Z"),
      stored: 1,
      status: "partial",
      missingAssets: ["AAPL"],
      ambiguousAssets: ["AAPL"],
    });

    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        active: true,
        prices: { status: "partial", missingAssets: ["AAPL"], ambiguousAssets: ["AAPL"] },
      },
    });
  });
});
