import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const ballotSource = readFileSync(new URL("./ballot.ts", import.meta.url), "utf8");
const deleteFlow = actionsSource.slice(actionsSource.indexOf("export async function deleteProposal"));
const distributionFlow = ballotSource.slice(
  ballotSource.indexOf("async function assertValidDistribution"),
  ballotSource.indexOf("function totalVotes"),
);

describe("proposal and vote serialization", () => {
  it("locks a proposal before deleting it", () => {
    const proposalLock = deleteFlow.indexOf('.for("update")');
    expect(proposalLock).toBeGreaterThan(-1);
    expect(deleteFlow.indexOf("transaction.update(proposals)")).toBeGreaterThan(proposalLock);
    expect(deleteFlow).not.toContain("not exists (");
    expect(deleteFlow).not.toContain("PROPOSAL_HAS_VOTES");
    expect(deleteFlow).not.toContain("transaction.update(ballots)");
    expect(deleteFlow).not.toContain("transaction.delete(ballotAllocations)");
  });

  it("locks voting proposals in stable ID order", () => {
    expect(distributionFlow).toContain(".sort()");
    expect(distributionFlow.indexOf("orderBy(asc(proposals.id))")).toBeLessThan(distributionFlow.indexOf('.for("update")'));
  });
});
