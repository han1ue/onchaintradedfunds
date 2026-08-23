import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("launch UI rule consistency", () => {
  it("removes the submission-week boost and states the verified pool comparison precisely", () => {
    const sources = [
      read("../../../launch-surface-brief.md"),
      read("../lib/types.ts"),
      read("../server/data.ts"),
      read("./SubmitWizard.tsx"),
      read("../app/rules/page.tsx"),
    ].join("\n");

    expect(sources).not.toMatch(/submissionBoost|Submission Week Boost|100% XP boost|100% boost/i);
    expect(sources).toContain("100% larger");
    expect(sources).toContain("Individual awards depend on relative score");
  });

  it("keeps closed vote records visible and does not use the pre-voting gate after close", () => {
    const ballot = read("./BallotPanel.tsx");
    const profile = read("../app/me/page.tsx");

    expect(ballot.indexOf("if (availability.competitionEnded)")).toBeLessThan(ballot.indexOf("if (!availability.votingOpen)"));
    expect(ballot).toContain("Voting post history");
    expect(profile).toContain('timing.stage === "submissions"');
    expect(profile).toContain('timing.stage === "review"');
    expect(profile).toContain('timing.stage === "final"');
    expect(profile).toContain('timing.stage === "cancelled"');
  });

  it("renders creator badges only when stored verification is true", () => {
    expect(read("./Leaderboard.tsx")).toContain("entry.creator.verified &&");
    expect(read("../app/otfs/[slug]/page.tsx")).toContain("proposal.creator.verified &&");
    expect(read("../server/data.ts")).toContain("'verified', o.creator_verified");
  });

  it("blocks portfolio navigation while any allocation is below the minimum", () => {
    const wizard = read("./SubmitWizard.tsx");
    expect(wizard).toContain("allWeightsMeetMinimum");
    expect(wizard).toContain('aria-invalid={weightBelowMinimum}');
    expect(wizard).toContain("|| !allWeightsMeetMinimum");
  });
});
