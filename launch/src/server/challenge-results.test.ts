import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeXActionChallenge } from "../lib/challenge-status";

const now = new Date("2026-08-23T12:00:00.000Z");
const base = {
  action: "submission" as const,
  proposalId: "22222222-2222-4222-8222-222222222222",
  resultBallotId: null,
  resultSlug: "durable-otf",
  expiresAt: new Date("2026-08-23T12:15:00.000Z"),
  consumedAt: null,
};

describe("X action challenge status", () => {
  it("returns ready after a failed transaction rolls back challenge consumption", () => {
    expect(describeXActionChallenge(base, now)).toEqual({ status: "ready" });
  });

  it("returns only the compact terminal proposal result after success", () => {
    expect(describeXActionChallenge({ ...base, consumedAt: now }, now)).toEqual({
      status: "succeeded",
      action: "submission",
      proposalId: base.proposalId,
      slug: "durable-otf",
      acceptedAt: now.toISOString(),
    });
  });

  it("returns the compact ballot reference after a successful vote update", () => {
    expect(describeXActionChallenge({
      ...base,
      action: "vote",
      proposalId: null,
      resultBallotId: "33333333-3333-4333-8333-333333333333",
      resultSlug: null,
      consumedAt: now,
    }, now)).toEqual({
      status: "succeeded",
      action: "vote",
      ballotId: "33333333-3333-4333-8333-333333333333",
      acceptedAt: now.toISOString(),
    });
  });

  it("returns expired without exposing the stored challenge payload", () => {
    expect(describeXActionChallenge({
      ...base,
      expiresAt: new Date("2026-08-23T11:59:59.000Z"),
    }, now)).toEqual({ status: "expired" });
  });

  it("scopes the database lookup to the authenticated owner", () => {
    const source = readFileSync(new URL("./challenge-results.ts", import.meta.url), "utf8");
    expect(source).toContain("const session = await requireSession()");
    expect(source).toContain("eq(xActionChallenges.userId, session.user.id)");
    expect(source).not.toContain("payload: xActionChallenges.payload");
  });
});
