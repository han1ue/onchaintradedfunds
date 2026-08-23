import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("./db/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0005_proposal_lifecycle.sql", import.meta.url), "utf8");
const wizard = readFileSync(new URL("../components/SubmitWizard.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/me/page.tsx", import.meta.url), "utf8");

describe("proposal draft lifecycle", () => {
  it("expires drafts lazily and releases their identity reservations", () => {
    expect(actions).toContain("expireStaleDrafts");
    expect(actions).toContain("PROPOSAL_DRAFT_TTL_MS");
    expect(schema).toContain('["draft", "confirmed", "expired", "deleted"]');
    expect(schema).not.toContain("<> 'deleted'");
    expect(schema.match(/in \('draft', 'confirmed'\)/g)).toHaveLength(3);
    expect(migration).toContain("interval '24 hours'");
    expect(migration.match(/WHERE \"proposals\"\.\"status\" in \('draft', 'confirmed'\)/g)).toHaveLength(3);
  });

  it("resumes and refreshes the same saved draft", () => {
    expect(wizard).toContain("draftId,");
    expect(wizard).toContain("initialDraft?.id ?? null");
    expect(profile).toContain("/submit?draft=${proposal.id}");
    expect(actions).toContain("transaction.update(proposals).set(values)");
  });
});

describe("confirmed proposal cap", () => {
  it("locks the competition before counting and confirming", () => {
    const confirmation = actions.slice(actions.indexOf("export async function verifyProposalProof"), actions.indexOf("export async function deleteProposal"));
    const lock = confirmation.indexOf('.for("update")');
    const count = confirmation.indexOf("confirmedCount");
    const limit = confirmation.indexOf("openCompetition.rules.maxProposalsPerAccount");
    const confirm = confirmation.indexOf('status: "confirmed"');
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lock);
    expect(limit).toBeGreaterThan(count);
    expect(confirm).toBeGreaterThan(limit);
  });

  it("preserves frozen rules when participant data exists", () => {
    for (const table of ["proposals", "tweet_evidence", "ballots", "vote_tranches"]) {
      expect(migration).toContain(`AND NOT EXISTS (SELECT 1 FROM "${table}"`);
    }
  });
});
