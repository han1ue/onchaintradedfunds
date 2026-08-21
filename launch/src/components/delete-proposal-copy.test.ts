import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DeleteProposalForm.tsx", import.meta.url), "utf8");

describe("proposal deletion confirmation", () => {
  it("explains that affected votes stay spent but do not earn voter XP", () => {
    expect(source).toContain('vote stays" : "votes stay"} spent and cannot be reassigned');
    expect(source).toContain("not count toward Participation or Performance XP");
  });
});
