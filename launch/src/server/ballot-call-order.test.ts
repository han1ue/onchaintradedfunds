import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ballot.ts", import.meta.url), "utf8");
const verifyFlow = source.slice(source.indexOf("export async function verifyBallotProof"));

describe("ballot verification call order", () => {
  it("spends TwitterAPI.io credits only after deterministic vote checks", () => {
    const paidRecheck = verifyFlow.indexOf("await recheckSubmissionEvidence");
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("await getNewestCompletePriceCheckpoint"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.lastIndexOf("await assertValidDistribution", paidRecheck));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.lastIndexOf("await assertBallotCanAccept", paidRecheck));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("const post = await getXPost"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("database.transaction"));
    expect(paidRecheck).toBeGreaterThan(verifyFlow.indexOf("assertVotesUnlocked(openCompetition.startsAt"));
    expect(paidRecheck).toBeLessThan(verifyFlow.indexOf("transaction.insert(tweetEvidence)"));
  });
});
