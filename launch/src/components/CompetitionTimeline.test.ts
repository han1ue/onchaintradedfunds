import { describe, expect, it } from "vitest";
import { timelineProgressPercent } from "./CompetitionTimeline";

describe("competition timeline progress", () => {
  it("keeps the fill inside submission week until voting starts", () => {
    const submissionBoundary = 7 / (7 + 30 + 10) * 100;

    expect(timelineProgressPercent(6.75, 37, false)).toBeLessThan(submissionBoundary);
    expect(timelineProgressPercent(7, 37, false)).toBeCloseTo(submissionBoundary);
  });

  it("enters final results only after all timed competition days", () => {
    const finalResultsBoundary = 37 / (7 + 30 + 10) * 100;

    expect(timelineProgressPercent(37, 37, false)).toBeCloseTo(finalResultsBoundary);
    expect(timelineProgressPercent(37, 37, true)).toBe(100);
  });
});
