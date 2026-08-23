import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wizard = readFileSync(new URL("./SubmitWizard.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/me/page.tsx", import.meta.url), "utf8");

describe("ambiguous draft creation recovery", () => {
  it("directs the user to My profile without automatically creating another draft", () => {
    expect(wizard).toContain("Don’t create another yet; check My profile");
    expect(wizard).toContain('href="/me"');
    expect(profile).not.toContain('ne(proposals.status, "draft")');
  });
});
