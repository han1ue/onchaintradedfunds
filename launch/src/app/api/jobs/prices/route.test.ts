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
    mocks.captureAssetPrices.mockResolvedValue({ stored: 46, complete: true });
  });

  it("stores scoring prices without capturing market evidence", async () => {
    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.assertCron).toHaveBeenCalledOnce();
    expect(mocks.captureAssetPrices).toHaveBeenCalledWith({ purpose: "scoring" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { prices: { stored: 46 } } });
  });

  it("does not capture before opening, after the competition ends, or after cancellation", async () => {
    mocks.priceCapturePurpose.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://launch.example/api/jobs/prices"));

    expect(mocks.captureAssetPrices).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ data: { active: false, purpose: null, prices: null } });
  });
});
