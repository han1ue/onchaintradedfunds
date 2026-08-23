import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0007_launch_data_invariants.sql", import.meta.url),
  "utf8",
);
const ballotSource = readFileSync(new URL("../ballot.ts", import.meta.url), "utf8");

function functionBody(name: string) {
  const start = migration.indexOf(`CREATE FUNCTION "${name}"`);
  expect(start).toBeGreaterThan(-1);
  const end = migration.indexOf("$$ LANGUAGE plpgsql;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("launch data invariant migration", () => {
  it("uses database acceptance timestamps", () => {
    expect(functionBody("stamp_confirmed_proposal_acceptance")).toContain("statement_timestamp()");
    expect(functionBody("stamp_vote_tranche_acceptance")).toContain("statement_timestamp()");
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "proposals"');
    expect(migration).toContain('BEFORE INSERT ON "vote_tranches"');
  });

  it("validates confirmed proposal composition from frozen competition rules", () => {
    const body = functionBody("assert_confirmed_proposal_invariants");
    for (const rule of ["minAssets", "minAssetWeightBps", "portfolioWeightBps"]) {
      expect(body).toContain(`c."rules"->>'${rule}'`);
    }
    expect(body).toContain("proposal_accepted_at IS NULL");
    expect(body).toContain('count(*)::integer');
    expect(body).toContain('sum(pa."weight_bps")');
    expect(body).toContain('pa."weight_bps" < minimum_asset_weight_bps');
  });

  it("rechecks confirmed proposals after parent or asset changes at commit", () => {
    for (const [trigger, table] of [
      ["proposal_invariants_valid", "proposals"],
      ["proposal_asset_invariants_valid", "proposal_assets"],
    ]) {
      expect(migration).toMatch(new RegExp(
        `CREATE CONSTRAINT TRIGGER "${trigger}"[\\s\\S]*?ON "${table}"[\\s\\S]*?DEFERRABLE INITIALLY DEFERRED`,
      ));
    }
  });

  it("ties allocations, tranches, proposals, evidence, competition, and voter together", () => {
    const body = functionBody("assert_ballot_invariants");
    expect(body).toContain('p."competition_id" IS DISTINCT FROM ballot_competition_id');
    expect(body).toContain('vt."competition_id" IS DISTINCT FROM ballot_competition_id');
    expect(body).toContain('vt."voter_user_id" IS DISTINCT FROM ballot_voter_user_id');
    expect(body).toContain('e."id" IS NULL');
    expect(body).toContain('e."action" IS DISTINCT FROM \'vote\'');
    expect(body).toContain('e."competition_id" IS DISTINCT FROM ballot_competition_id');
    expect(body).toContain('e."user_id" IS DISTINCT FROM ballot_voter_user_id');
  });

  it("requires allocation totals to equal tranche totals and stay within totalVotes", () => {
    const body = functionBody("assert_ballot_invariants");
    expect(body).toContain('sum(vt."quantity")');
    expect(body).toContain('ba."votes" IS DISTINCT FROM COALESCE(totals."quantity", 0)');
    expect(body).toContain("BALLOT_ALLOCATION_TRANCHE_MISMATCH");
    expect(body).toContain("allocation_total > total_votes_rule");
    expect(body).toContain("c.\"rules\"->>'totalVotes'");
  });

  it("checks cumulative votes at database-stamped tranche times using unlock rules", () => {
    const body = functionBody("assert_ballot_invariants");
    for (const rule of ["submissionOnlyDays", "initialVotes", "votesPerUnlock", "voteUnlockIntervalDays"]) {
      expect(body).toContain(`c."rules"->>'${rule}'`);
    }
    expect(body).toContain('GROUP BY vt."accepted_at"');
    expect(body).toContain('ORDER BY vt."accepted_at"');
    expect(body).toContain("cumulative_votes > unlocked_votes");
    expect(body).toContain("extract(epoch FROM interval '1 day')");
    expect(body).not.toMatch(/(?:allocation_total|cumulative_votes)\s*>\s*12\b/);
  });

  it("defers checks on every related ballot table and audits existing rows", () => {
    for (const [trigger, table] of [
      ["ballot_invariants_valid", "ballots"],
      ["ballot_allocation_invariants_valid", "ballot_allocations"],
      ["vote_tranche_invariants_valid", "vote_tranches"],
      ["evidence_ballot_invariants_valid", "tweet_evidence"],
      ["competition_participation_invariants_valid", "competitions"],
    ]) {
      expect(migration).toMatch(new RegExp(
        `CREATE CONSTRAINT TRIGGER "${trigger}"[\\s\\S]*?ON "${table}"[\\s\\S]*?DEFERRABLE INITIALLY DEFERRED`,
      ));
    }
    expect(migration).toContain('FOR target_id IN SELECT p."id" FROM "proposals"');
    expect(migration).toContain('FOR target_id IN SELECT b."id" FROM "ballots"');
  });

  it("resets invalid ballot tranche history before accepting a replacement ballot", () => {
    const resetStart = ballotSource.indexOf("if (existing && !isUpdate)");
    const resetEnd = ballotSource.indexOf("transaction.insert(ballotAllocations)", resetStart);
    const resetFlow = ballotSource.slice(resetStart, resetEnd);
    expect(resetFlow.indexOf("transaction.delete(voteTranches)")).toBeGreaterThan(-1);
    expect(resetFlow.indexOf("transaction.delete(voteTranches)"))
      .toBeLessThan(resetFlow.indexOf("transaction.delete(ballotAllocations)"));
  });
});
