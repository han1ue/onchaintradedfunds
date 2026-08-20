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
  it("consistently states that eligible accounts may submit unlimited proposals", () => {
    const combined = policySurfaces.join("\n");
    expect(combined).not.toMatch(/(?:one|1) OTF (?:proposal )?per X account/i);
    expect(combined.match(/as many OTF proposals as/g)).toHaveLength(policySurfaces.length);
  });
});
