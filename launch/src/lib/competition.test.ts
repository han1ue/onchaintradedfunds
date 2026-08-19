import { describe, expect, it } from "vitest";
import { getCompetitionTiming, getNextVoteUnlockAt, getUnlockedVoteCount, getVotingStartsAt } from "./competition";

const startsAt = new Date("2026-08-01T00:00:00.000Z");

describe("competition phases", () => {
  it("keeps the first seven days submission-only", () => {
    expect(getVotingStartsAt(startsAt).toISOString()).toBe("2026-08-08T00:00:00.000Z");
    const timing = getCompetitionTiming({ phase: "open", startsAt, endsAt: "2026-09-07T00:00:00.000Z" }, new Date("2026-08-07T23:59:59.999Z"));
    expect(timing.stage).toBe("submissions");
    expect(timing.votingOpen).toBe(false);
    expect(timing.submissionsOpen).toBe(true);
  });

  it("advances timeline progress in six-hour intervals without pre-filling day one", () => {
    const competition = { phase: "open" as const, startsAt, endsAt: "2026-09-07T00:00:00.000Z" };
    expect(getCompetitionTiming(competition, startsAt).progressDays).toBe(0);
    expect(getCompetitionTiming(competition, new Date("2026-08-01T05:59:59.999Z")).progressDays).toBe(0);

    const sixHoursIn = getCompetitionTiming(competition, new Date("2026-08-01T06:00:00.000Z"));
    expect(sixHoursIn.competitionDay).toBe(1);
    expect(sixHoursIn.progressDays).toBe(0.25);
    expect(getCompetitionTiming(competition, new Date("2026-08-01T11:59:59.999Z")).progressDays).toBe(0.25);
    expect(getCompetitionTiming(competition, new Date("2026-08-01T12:00:00.000Z")).progressDays).toBe(0.5);
  });

  it("opens voting on competition day 8 with exactly 3 votes", () => {
    const timing = getCompetitionTiming({ phase: "open", startsAt, endsAt: "2026-09-07T00:00:00.000Z" }, new Date("2026-08-08T00:00:00.000Z"));
    expect(timing.stage).toBe("voting");
    expect(timing.competitionDay).toBe(8);
    expect(timing.unlockedVotes).toBe(3);
    expect(timing.submissionsOpen).toBe(true);
  });
});

describe("vote unlocking", () => {
  it("unlocks one vote every three voting days", () => {
    expect(getUnlockedVoteCount(startsAt, new Date("2026-08-08T00:00:00.000Z"))).toBe(3);
    expect(getUnlockedVoteCount(startsAt, new Date("2026-08-11T00:00:00.000Z"))).toBe(4);
    expect(getUnlockedVoteCount(startsAt, new Date("2026-08-14T00:00:00.000Z"))).toBe(5);
  });

  it("caps at 12 on voting day 27 and grants nothing on day 30", () => {
    expect(getUnlockedVoteCount(startsAt, new Date("2026-09-04T00:00:00.000Z"))).toBe(12);
    expect(getUnlockedVoteCount(startsAt, new Date("2026-09-07T00:00:00.000Z"))).toBe(12);
    expect(getNextVoteUnlockAt(startsAt, new Date("2026-09-04T00:00:00.000Z"))).toBeNull();
  });
});
