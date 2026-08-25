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
  it("consistently reflects the frozen competition proposal limit", () => {
    const combined = policySurfaces.join("\n");
    expect(combined).toMatch(/as many OTF proposals as/i);
    for (const surface of policySurfaces) expect(surface).toContain("maxProposalsPerAccount");
  });

  it("allows winning creators to adjust portfolios while recommending thesis continuity", () => {
    const rulesPage = readFileSync(new URL("./rules/page.tsx", import.meta.url), "utf8");

    expect(rulesPage).toContain("Winning creators may adjust their OTF’s assets and weights before launch");
    expect(rulesPage).toContain("strongly recommend preserving the investment thesis the community voted for");
  });
});
