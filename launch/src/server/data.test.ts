import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry } from "@/lib/types";

const mocks = vi.hoisted(() => ({ sqlClient: vi.fn() }));

vi.mock("./db", () => ({ sqlClient: mocks.sqlClient }));

import { getLeaderboard, getProposal, paginateRankedEntries } from "./data";

function proposal(rank: number): LeaderboardEntry {
  return {
    id: `proposal-${rank}`,
    slug: `proposal-${rank}`,
    rank,
    name: `Proposal ${rank} OTF`,
    ticker: `OTF${rank}`,
    thesis: `Thesis ${rank}`,
    creator: { xId: `x-${rank}`, username: `creator${rank}`, displayName: `Creator ${rank}`, verified: false },
    votes: 200 - rank,
    acceptedAt: new Date(Date.UTC(2026, 7, 1, 0, rank)).toISOString(),
    allocations: [],
  };
}

describe("proposal list queries", () => {
  beforeEach(() => mocks.sqlClient.mockReset());

  it("looks up one proposal directly instead of loading the leaderboard", async () => {
    const expected = proposal(73);
    mocks.sqlClient.mockResolvedValueOnce([expected]);

    await expect(getProposal(expected.slug)).resolves.toEqual(expected);

    expect(mocks.sqlClient).toHaveBeenCalledOnce();
    const [strings, ...values] = mocks.sqlClient.mock.calls[0];
    const query = (strings as TemplateStringsArray).join("?");
    expect(query).toContain("where o.slug = ?");
    expect(query).toContain("limit 1");
    expect(values).toContain(expected.slug);
  });

  it("assigns global ranks before cursor and page limiting", async () => {
    mocks.sqlClient.mockResolvedValueOnce([proposal(51), proposal(52)]);

    await expect(getLeaderboard({ limit: 1, cursor: 50 })).resolves.toEqual({
      entries: [proposal(51)],
      nextCursor: "51",
    });

    const [strings] = mocks.sqlClient.mock.calls[0];
    const query = (strings as TemplateStringsArray).join("?");
    expect(query.indexOf("row_number() over")).toBeLessThan(query.indexOf("where o.rank >"));
    expect(query.indexOf("where o.rank >")).toBeLessThan(query.lastIndexOf("limit ?"));
  });

  it("keeps global ranks stable across pages and search results", () => {
    const entries = Array.from({ length: 105 }, (_, index) => proposal(index + 1));
    const first = paginateRankedEntries(entries);
    const second = paginateRankedEntries(entries, { cursor: Number(first.nextCursor) });
    const searched = paginateRankedEntries(entries, { search: "Proposal 75" });

    expect(first.entries).toHaveLength(50);
    expect(first.entries.at(-1)?.rank).toBe(50);
    expect(second.entries[0]?.rank).toBe(51);
    expect(second.nextCursor).toBe("100");
    expect(searched.entries[0]?.rank).toBe(75);
  });
});
