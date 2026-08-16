import { describe, expect, it } from "vitest";
import {
  evaluateCompetitionPoolAge,
  evaluateMarketEvidence,
  evaluateMarketEvidenceContinuity,
  type MarketEvidenceInput,
} from "./market-evidence-policy";

const now = new Date("2026-08-16T12:00:00Z");
const competitionStartsAt = new Date("2026-08-09T12:00:00Z");
const passing = (overrides: Partial<MarketEvidenceInput> = {}): MarketEvidenceInput => ({
  sampledAt: now,
  competitionStartsAt,
  liquidityUsd: 30_000,
  marketCapUsd: 100_000,
  marketCapVerified: true,
  poolCreatedAt: new Date(competitionStartsAt.getTime() - 7 * 86_400_000),
  gtVerified: true,
  gtScore: 60,
  isHoneypot: false,
  lockedLiquidityPct: 50,
  ...overrides,
});

describe("informational provider market evidence", () => {
  it("passes every threshold boundary exactly", () => {
    expect(evaluateMarketEvidence(passing())).toEqual({ status: "Pass", reasons: [] });
  });

  it("anchors pool age to the competition start", () => {
    expect(evaluateCompetitionPoolAge(new Date(competitionStartsAt.getTime() - 7 * 86_400_000), competitionStartsAt).status).toBe("Pass");
    expect(evaluateMarketEvidence(passing({ poolCreatedAt: new Date(competitionStartsAt.getTime() - 7 * 86_400_000 + 1) }))).toEqual({
      status: "Fail",
      reasons: ["Pool was not at least seven days old when the competition started"],
    });
  });

  it("keeps missing provider evidence pending without substituting FDV", () => {
    const result = evaluateMarketEvidence(passing({ marketCapUsd: null, gtScore: null }));
    expect(result.status).toBe("Pending");
    expect(result.reasons).toContain("Verified market cap is unavailable");
    expect(result.reasons).toContain("GT score is unavailable");
  });

  it("reports provider security and liquidity breaches", () => {
    const result = evaluateMarketEvidence(passing({ liquidityUsd: 29_999, marketCapVerified: false, isHoneypot: true }));
    expect(result.status).toBe("Fail");
    expect(result.reasons).toHaveLength(3);
  });

  it("evaluates seven continuous days of hourly evidence without gating XP", () => {
    const checkpoints: { sampledAt: Date; status: "Pass" | "Pending" | "Fail" }[] = Array.from({ length: 169 }, (_, index) => ({
      sampledAt: new Date(now.getTime() - (168 - index) * 60 * 60_000),
      status: "Pass" as const,
    }));
    expect(evaluateMarketEvidenceContinuity(checkpoints, now).status).toBe("Pass");
    checkpoints[100] = { ...checkpoints[100], status: "Pending" };
    expect(evaluateMarketEvidenceContinuity(checkpoints, now).status).toBe("Pending");
  });
});
