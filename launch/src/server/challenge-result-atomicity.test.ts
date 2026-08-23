import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const proposalSource = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const ballotSource = readFileSync(new URL("./ballot.ts", import.meta.url), "utf8");

describe("X challenge result atomicity", () => {
  it("records the proposal result inside the confirmation transaction", () => {
    const flow = proposalSource.slice(
      proposalSource.indexOf("export async function verifyProposalProof"),
      proposalSource.indexOf("export async function deleteProposal"),
    );
    expect(flow.indexOf("database.transaction")).toBeLessThan(flow.indexOf("resultSlug: proposal.slug"));
    expect(flow.indexOf("resultSlug: proposal.slug")).toBeLessThan(flow.indexOf("return result"));
  });

  it("records the ballot ID before the ballot transaction can commit", () => {
    const flow = ballotSource.slice(ballotSource.indexOf("export async function verifyBallotProof"));
    expect(flow.indexOf("database.transaction")).toBeLessThan(flow.indexOf("resultBallotId: ballot.id"));
    expect(flow.indexOf("resultBallotId: ballot.id")).toBeLessThan(flow.indexOf("return result"));
    expect(flow).toContain('if (!recordedResult) throw new Error("CHALLENGE_RESULT_UNAVAILABLE")');
  });
});
