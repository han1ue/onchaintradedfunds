import { describe, expect, it } from "vitest";
import { COMPETITION_RULES, COMPETITION_RULES_HASH } from "@/lib/competition";
import { assertCompetitionRulesSnapshot, hashCompetitionRules } from "./competition-rules";
import { readFileSync } from "node:fs";

const baseline = readFileSync(new URL("../../drizzle/0000_launch_baseline.sql", import.meta.url), "utf8");
const backfill = readFileSync(new URL("../../drizzle/0001_frozen_competition_rules.sql", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../../drizzle/0005_proposal_lifecycle.sql", import.meta.url), "utf8");

describe("competition rules snapshot", () => {
  it("matches the published canonical hash", () => {
    expect(hashCompetitionRules(COMPETITION_RULES)).toBe(COMPETITION_RULES_HASH);
    expect(assertCompetitionRulesSnapshot(COMPETITION_RULES, COMPETITION_RULES_HASH)).toBe(COMPETITION_RULES);
    expect(COMPETITION_RULES.maxProposalsPerAccount).toBe(10);
    expect(lifecycle).toContain(`'${COMPETITION_RULES_HASH}'`);
    expect(baseline).toContain("\"maxProposalsPerAccount\":null");
    expect(backfill).toContain("\"maxProposalsPerAccount\":null");
    expect(backfill).toContain('ADD COLUMN IF NOT EXISTS "rules"');
    expect(lifecycle).toContain("AND NOT EXISTS (SELECT 1 FROM \"proposals\"");
    expect(lifecycle).toContain("AND NOT EXISTS (SELECT 1 FROM \"tweet_evidence\"");
    expect(lifecycle).toContain("AND NOT EXISTS (SELECT 1 FROM \"ballots\"");
    expect(lifecycle).toContain("AND NOT EXISTS (SELECT 1 FROM \"vote_tranches\"");
    expect(baseline).toContain("OLD.\"phase\" IN ('open', 'auditing', 'final', 'cancelled')");
    expect(baseline).toContain("RAISE EXCEPTION 'Competition rules are frozen'");
  });

  it("rejects rules that do not match their frozen hash", () => {
    expect(() => assertCompetitionRulesSnapshot({ ...COMPETITION_RULES, totalVotes: 13 }, COMPETITION_RULES_HASH))
      .toThrow("COMPETITION_RULES_INVALID");
  });
});
