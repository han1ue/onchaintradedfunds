import { describe, expect, it } from "vitest";
import { selectRecentProposals } from "./recent-activity";

describe("homepage recent activity", () => {
  it("shows the newest proposals and ignores vote totals", () => {
    const proposals = [
      { id: "old-popular", acceptedAt: "2026-08-10T12:00:00.000Z", votes: 100 },
      { id: "new-no-votes", acceptedAt: "2026-08-12T12:00:00.000Z", votes: 0 },
      { id: "middle", acceptedAt: "2026-08-11T12:00:00.000Z", votes: 2 },
    ];

    expect(selectRecentProposals(proposals).map((proposal) => proposal.id)).toEqual([
      "new-no-votes",
      "middle",
      "old-popular",
    ]);
    expect(proposals.map((proposal) => proposal.id)).toEqual(["old-popular", "new-no-votes", "middle"]);
  });

  it("limits the homepage feed to three proposals", () => {
    const proposals = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      acceptedAt: new Date(Date.UTC(2026, 7, 10 + index)).toISOString(),
    }));

    expect(selectRecentProposals(proposals).map((proposal) => proposal.id)).toEqual(["4", "3", "2"]);
  });
});
