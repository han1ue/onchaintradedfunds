import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCron: vi.fn(),
  captureMarketEvidence: vi.fn(),
}));

vi.mock("@/server/cron", () => ({ assertCron: mocks.assertCron }));
vi.mock("@/server/market-evidence", () => ({ captureMarketEvidence: mocks.captureMarketEvidence }));

import { GET } from "./route";

describe("hourly market evidence job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureMarketEvidence.mockResolvedValue({ markets: [] });
  });

  it("captures only canonical market evidence", async () => {
    const response = await GET(new Request("https://launch.example/api/jobs/evidence"));

    expect(mocks.assertCron).toHaveBeenCalledOnce();
    expect(mocks.captureMarketEvidence).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});
