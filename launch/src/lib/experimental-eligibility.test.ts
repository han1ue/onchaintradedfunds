import { describe, expect, it } from "vitest";
import {
  evaluateCompetitionPoolAge,
  evaluateExperimentalEvidence,
  evaluateSevenDayContinuity,
  type ExperimentalEligibilityEvidence,
} from "./experimental-eligibility";

const now = new Date("2026-08-16T12:00:00Z");
const competitionStartsAt = new Date("2026-08-09T12:00:00Z");
const passing = (overrides: Partial<ExperimentalEligibilityEvidence> = {}): ExperimentalEligibilityEvidence => ({
  sampledAt: now,
  competitionStartsAt,
  liquidityUsd: 30_000,
  marketCapUsd: 100_000,
  marketCapVerified: true,
  poolCreatedAt: new Date(competitionStartsAt.getTime() - 7 * 86_400_000),
  observationsReady24h: true,
  gtVerified: true,
  gtScore: 60,
  isHoneypot: false,
  criticalSellOrTaxFlag: false,
  lockedLiquidityPct: 50,
  buyImpactPct: 2,
  sellImpactPct: 2,
  ...overrides,
});

describe("experimental OTF performance eligibility", () => {
  it("passes every threshold boundary exactly", () => {
    expect(evaluateExperimentalEvidence(passing())).toEqual({ status: "Pass", reasons: [] });
  });

  it("anchors pool age to the competition start rather than the evidence sample", () => {
    expect(evaluateCompetitionPoolAge(
      new Date(competitionStartsAt.getTime() - 7 * 86_400_000),
      competitionStartsAt,
    ).status).toBe("Pass");
    const tooNew = evaluateExperimentalEvidence(passing({
      poolCreatedAt: new Date(competitionStartsAt.getTime() - 7 * 86_400_000 + 1),
    }));
    expect(tooNew).toEqual({
      status: "Fail",
      reasons: ["Pool was not at least seven days old when the competition started"],
    });
  });

  it("keeps pool age pending when the competition boundary is unavailable", () => {
    const result = evaluateExperimentalEvidence(passing({ competitionStartsAt: null }));
    expect(result.status).toBe("Pending");
    expect(result.reasons).toContain("Competition start time is unavailable");
  });

  it("never substitutes FDV or assumes missing provider evidence", () => {
    const result = evaluateExperimentalEvidence(passing({ marketCapUsd: null, gtScore: null }));
    expect(result.status).toBe("Pending");
    expect(result.reasons).toContain("Verified market cap is unavailable");
    expect(result.reasons).toContain("GT score is unavailable");
  });

  it("fails security, liquidity, and depth breaches", () => {
    const result = evaluateExperimentalEvidence(passing({
      liquidityUsd: 29_999,
      marketCapVerified: false,
      isHoneypot: true,
      sellImpactPct: 2.01,
    }));
    expect(result.status).toBe("Fail");
    expect(result.reasons).toHaveLength(4);
  });

  it("requires seven continuous days of passing hourly checkpoints", () => {
    const checkpoints: { sampledAt: Date; status: "Pass" | "Pending" | "Fail" }[] = Array.from({ length: 169 }, (_, index) => ({
      sampledAt: new Date(now.getTime() - (168 - index) * 60 * 60_000),
      status: "Pass" as const,
    }));
    expect(evaluateSevenDayContinuity(checkpoints, now).status).toBe("Pass");
    checkpoints[100] = { ...checkpoints[100], status: "Pending" };
    expect(evaluateSevenDayContinuity(checkpoints, now).status).toBe("Pending");
  });

  it("does not accept a dense checkpoint set that starts late", () => {
    const checkpoints = Array.from({ length: 168 }, (_, index) => ({
      sampledAt: new Date(now.getTime() - (167 - index) * 60 * 60_000),
      status: "Pass" as const,
    }));
    expect(evaluateSevenDayContinuity(checkpoints, now).status).toBe("Pending");
  });
});
