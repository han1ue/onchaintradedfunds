import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const prices = readFileSync(new URL("./prices.ts", import.meta.url), "utf8");
const guards = readFileSync(new URL("./guards.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0003_stage_draft_allocations.sql", import.meta.url), "utf8");

describe("proposal asset registration lifecycle", () => {
  it("stores draft allocations without registering or linking assets", () => {
    const draftFlow = actions.slice(actions.indexOf("export async function saveProposalDraft"), actions.indexOf("async function validateDraftAllocationsForConfirmation"));
    expect(draftFlow).toContain("draftAllocations");
    expect(draftFlow).not.toContain("transaction.insert(assetRegistry)");
    expect(draftFlow).not.toContain("transaction.insert(assetMarkets)");
    expect(draftFlow).not.toContain("transaction.insert(proposalAssets)");
  });

  it("registers and links assets in the same transaction that confirms the proposal", () => {
    const confirmationFlow = actions.slice(actions.indexOf("export async function verifyProposalProof"), actions.indexOf("export async function deleteProposal"));
    expect(confirmationFlow).toContain("database.transaction");
    expect(confirmationFlow).toContain("registerAndLinkProposalAssets(transaction, proposal.id, preparedAssets)");
    expect(confirmationFlow).toContain('status: "confirmed"');
  });

  it("reuses assets and markets when concurrent or shared proposals register duplicates", () => {
    const registrationFlow = actions.slice(actions.indexOf("async function registerAndLinkProposalAssets"), actions.indexOf("function newChallengeToken"));
    expect(registrationFlow).toContain("let [asset] = await findAsset()");
    expect(registrationFlow).toContain("let [market] = await findMarket()");
    expect(registrationFlow.match(/onConflictDoNothing\(\)/g)).toHaveLength(2);
  });

  it("migrates existing drafts out of proposal asset links", () => {
    expect(migration).toContain('ADD COLUMN "draft_allocations"');
    expect(migration).toContain("jsonb_agg");
    expect(migration).toContain('DELETE FROM "proposal_assets"');
    expect(migration).toContain("p.status = 'draft'");
  });
});

describe("scheduled price asset selection", () => {
  it("selects each asset once from confirmed proposals only", () => {
    expect(prices).toContain("database.selectDistinct");
    expect(prices).toContain(".innerJoin(proposalAssets");
    expect(prices).toContain(".innerJoin(proposals");
    expect(prices).toContain('.where(eq(proposals.status, "confirmed"))');
  });

  it("keeps a shared asset when one proposal is deleted and excludes draft/deleted-only assets", () => {
    expect(prices).toContain('.where(eq(proposals.status, "confirmed"))');
    expect(prices).not.toContain('inArray(proposals.status, ["draft", "confirmed"])');
  });

  it("stops captures at competition end without a final checkpoint", () => {
    const purposeFlow = guards.slice(guards.indexOf("export async function priceCapturePurpose"), guards.indexOf("export async function requireEligibleActor"));
    expect(purposeFlow).toContain('return "scoring" as const');
    expect(purposeFlow).not.toContain('return "final"');
  });
});
