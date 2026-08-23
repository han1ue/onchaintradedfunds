import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const policySurfaces = [
  new URL("./page.tsx", import.meta.url),
  new URL("./rules/page.tsx", import.meta.url),
  new URL("./submit/page.tsx", import.meta.url),
  new URL("../components/CompetitionTimeline.tsx", import.meta.url),
  new URL("../components/SubmitWizard.tsx", import.meta.url),
].map((url) => readFileSync(url, "utf8"));

describe("OTF submission policy copy", () => {
  it("consistently states the configured confirmed-proposal limit", () => {
    const combined = policySurfaces.join("\n");
    expect(combined).not.toMatch(/as many OTF proposals as|unlimited proposals/i);
    for (const surface of policySurfaces) expect(surface).toContain("maxProposalsPerAccount");
  });
});
