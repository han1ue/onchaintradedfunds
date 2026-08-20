import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ballot.ts", import.meta.url), "utf8");
const prepareFlow = source.slice(
  source.indexOf("export async function prepareBallotProof"),
  source.indexOf("export async function verifyBallotProof"),
);
const verifyFlow = source.slice(source.indexOf("export async function verifyBallotProof"));

describe("ballot verification call order", () => {
  it("checks checkpoint availability before creating an X-post challenge", () => {
    const checkpointCheck = prepareFlow.indexOf("await getNewestPriceCheckpointForAssets");
    expect(checkpointCheck).toBeGreaterThan(prepareFlow.indexOf("await assertValidDistribution"));
    expect(checkpointCheck).toBeLessThan(prepareFlow.indexOf("const token = newChallengeToken"));
    expect(checkpointCheck).toBeLessThan(prepareFlow.indexOf("database.insert(xActionChallenges)"));
  });

  it("spends TwitterAPI.io credits after deterministic checks but before opening the transaction", () => {
    const paidRecheck = verifyFlow.indexOf("await recheckSubmissionEvidence");
    const lockedProposalValidation = verifyFlow.indexOf("await assertValidDistribution(transaction, competition.id, additions, { lock: true })");
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("await getNewestPriceCheckpointForAssets"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("await assertValidDistribution"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("await assertBallotCanAccept"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("const post = await getXPost"));
    expect(paidRecheck).toBeLessThan(verifyFlow.indexOf("database.transaction"));
    expect(lockedProposalValidation).toBeGreaterThan(verifyFlow.indexOf("database.transaction"));
    expect(lockedProposalValidation).toBeGreaterThan(paidRecheck);
  });
});
