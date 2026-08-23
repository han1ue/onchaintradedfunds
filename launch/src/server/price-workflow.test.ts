import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../../.github/workflows/launch-price-checkpoints.yml", import.meta.url), "utf8");

describe("price checkpoint workflow", () => {
  it("keeps partial captures successful while surfacing missing assets", () => {
    expect(workflow).toContain('status" == "partial"');
    expect(workflow).toContain("missingAssets");
    expect(workflow).toContain("::warning title=Partial price checkpoint");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
  });
});
