import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminSource = readFileSync(new URL("./admin.ts", import.meta.url), "utf8");
const moderationFlow = adminSource.slice(
  adminSource.indexOf("export async function moderateProposal"),
  adminSource.indexOf("export async function recheckEvidence"),
);

describe("proposal moderation auditability", () => {
  it("locks, updates, and audits the proposal in one transaction", () => {
    const transaction = moderationFlow.indexOf("database.transaction");
    const lock = moderationFlow.indexOf('.for("update", { of: proposals })');
    const update = moderationFlow.indexOf("transaction.update(proposals)");
    const audit = moderationFlow.indexOf("transaction.insert(adminActions)");

    expect(transaction).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(transaction);
    expect(update).toBeGreaterThan(lock);
    expect(audit).toBeGreaterThan(update);
  });
});
