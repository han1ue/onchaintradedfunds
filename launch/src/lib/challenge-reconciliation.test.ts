import { describe, expect, it, vi } from "vitest";
import { requestWithChallengeReconciliation } from "./challenge-reconciliation";

const challengeId = "11111111-1111-4111-8111-111111111111";

describe("permanent X action reconciliation", () => {
  it("recovers normal success when the response is lost after the database commit", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(Response.json({
      data: {
        status: "succeeded",
        action: "submission",
        proposalId: "22222222-2222-4222-8222-222222222222",
        slug: "durable-otf",
        acceptedAt: "2026-08-23T12:00:00.000Z",
      },
    }));

    const outcome = await requestWithChallengeReconciliation(
      async () => new Response("response connection closed", { status: 201 }),
      challengeId,
      fetchStatus as unknown as typeof fetch,
      () => true,
    );

    expect(outcome).toEqual({
      kind: "status",
      status: expect.objectContaining({ status: "succeeded", action: "submission", slug: "durable-otf" }),
    });
    expect(fetchStatus).toHaveBeenCalledWith(`/api/v1/x-challenges/${challengeId}`, { method: "GET", cache: "no-store" });
  });

  it("permits a safe retry when the request fails before the transaction commits", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(Response.json({ data: { status: "ready" } }));

    const outcome = await requestWithChallengeReconciliation(
      async () => { throw new TypeError("network connection reset"); },
      challengeId,
      fetchStatus as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ kind: "status", status: { status: "ready" } });
  });

  it("requests a fresh challenge when the unresolved attempt has expired", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(Response.json({ data: { status: "expired" } }));

    const outcome = await requestWithChallengeReconciliation(
      async () => new Response("not json", { status: 502 }),
      challengeId,
      fetchStatus as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ kind: "status", status: { status: "expired" } });
  });
});
