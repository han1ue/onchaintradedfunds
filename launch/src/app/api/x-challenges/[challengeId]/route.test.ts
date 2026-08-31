import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getXActionChallengeStatus: vi.fn() }));

vi.mock("@/server/api", () => ({
  apiOk: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  apiError: (error: unknown) => Response.json({ error: { code: error instanceof Error ? error.message : "INTERNAL_ERROR" } }, { status: 404 }),
}));
vi.mock("@/server/challenge-results", () => ({ getXActionChallengeStatus: mocks.getXActionChallengeStatus }));

import { GET } from "./route";

const challengeId = "11111111-1111-4111-8111-111111111111";

describe("authenticated X challenge status route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only the reconciliable terminal reference and disables caching", async () => {
    mocks.getXActionChallengeStatus.mockResolvedValue({
      status: "succeeded",
      action: "submission",
      proposalId: "22222222-2222-4222-8222-222222222222",
      slug: "durable-otf",
      acceptedAt: "2026-08-23T12:00:00.000Z",
    });

    const response = await GET(new Request(`https://launch.example/api/x-challenges/${challengeId}`), {
      params: Promise.resolve({ challengeId }),
    });

    expect(mocks.getXActionChallengeStatus).toHaveBeenCalledWith(challengeId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      data: {
        status: "succeeded",
        action: "submission",
        proposalId: "22222222-2222-4222-8222-222222222222",
        slug: "durable-otf",
        acceptedAt: "2026-08-23T12:00:00.000Z",
      },
    });
  });

  it("does not reveal a challenge rejected by the owner-scoped lookup", async () => {
    mocks.getXActionChallengeStatus.mockRejectedValue(new Error("CHALLENGE_NOT_FOUND"));

    const response = await GET(new Request(`https://launch.example/api/x-challenges/${challengeId}`), {
      params: Promise.resolve({ challengeId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "CHALLENGE_NOT_FOUND" } });
  });
});
