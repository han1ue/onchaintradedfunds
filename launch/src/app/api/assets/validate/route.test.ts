import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  requireEligibleActor: vi.fn(),
  enforceRateLimit: vi.fn(),
  validateUnlistedAsset: vi.fn(),
}));

vi.mock("@/server/api", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
  apiOk: (data: unknown) => Response.json({ data }),
  apiError: (error: unknown, fallback: string) => Response.json({ error: { code: error instanceof Error ? error.message : fallback } }, { status: 400 }),
}));
vi.mock("@/server/guards", () => ({ requireEligibleActor: mocks.requireEligibleActor }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/server/unlisted-asset-validation", () => ({ validateUnlistedAsset: mocks.validateUnlistedAsset }));

import { GET } from "./route";

const assetAddress = "0x0000000000000000000000000000000000000001";
const startsAt = new Date("2026-08-20T12:00:00.000Z");

describe("asset validation abuse controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEligibleActor.mockResolvedValue({ session: { user: { id: "user-1" } }, competition: { startsAt } });
    mocks.validateUnlistedAsset.mockResolvedValue({ status: "pass" });
  });

  it("requires an eligible actor and rate-limits before external validation", async () => {
    const request = new Request(`https://launch.example/api/assets/validate?assetAddress=${assetAddress}`);
    const response = await GET(request);

    expect(mocks.assertSameOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireEligibleActor).toHaveBeenCalledOnce();
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("asset", request, "user-1");
    expect(mocks.enforceRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.validateUnlistedAsset.mock.invocationCallOrder[0]);
    expect(mocks.validateUnlistedAsset).toHaveBeenCalledWith({ assetAddress, poolAddress: undefined, competitionStartsAt: startsAt });
    expect(response.status).toBe(200);
  });

  it("does not validate assets for unauthenticated callers", async () => {
    mocks.requireEligibleActor.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));

    const response = await GET(new Request(`https://launch.example/api/assets/validate?assetAddress=${assetAddress}`));

    expect(response.status).toBe(400);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.validateUnlistedAsset).not.toHaveBeenCalled();
  });
});
