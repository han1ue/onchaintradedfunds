import { describe, expect, it } from "vitest";
import { generatedVoterAlias, publicVoterName, rankVotersByXp } from "./voter-alias";

describe("voter leaderboard privacy", () => {
  it("generates a stable funny alias without exposing the username", () => {
    const first = publicVoterName({ userId: "user-secret-id", username: "real_handle", allowRealUsername: false });
    const retry = publicVoterName({ userId: "user-secret-id", username: "real_handle", allowRealUsername: false });
    expect(first).toBe(retry);
    expect(first).not.toContain("real_handle");
    expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/);
  });

  it("uses the real X username only after explicit authorization", () => {
    expect(publicVoterName({ userId: "user", username: "real_handle", allowRealUsername: true })).toBe("@real_handle");
  });

  it("generates different aliases for different users", () => {
    expect(generatedVoterAlias("user-a")).not.toBe(generatedVoterAlias("user-b"));
  });

  it("ranks voters by XP rather than vote count", () => {
    const ranked = rankVotersByXp([
      { userId: "many-votes", totalXp: 200, votesCast: 12 },
      { userId: "high-xp", totalXp: 900, votesCast: 3 },
    ]);
    expect(ranked.map((row) => row.userId)).toEqual(["high-xp", "many-votes"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2]);
  });
});
