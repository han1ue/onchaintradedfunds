export const COMPETITION_IDENTITY = {
  slug: "genesis",
  name: "Genesis Competition",
} as const;

export const COMPETITION_RULES = {
  minFollowers: 100,
  minAccountAgeDays: 30,
  minAssets: 2,
  minAssetWeightBps: 100,
  portfolioWeightBps: 10_000,
  submissionOnlyDays: 7,
  votingDays: 30,
  initialVotes: 3,
  voteUnlockIntervalDays: 3,
  totalVotes: 12,
} as const;

export const DAY_MS = 86_400_000;

type CompetitionWindow = {
  phase: "draft" | "scheduled" | "open" | "auditing" | "final" | "cancelled";
  startsAt: string | Date;
  endsAt: string | Date;
};

export type CompetitionStage = "upcoming" | "submissions" | "voting" | "review" | "final" | "cancelled";

export function getVotingStartsAt(startsAt: string | Date) {
  return new Date(new Date(startsAt).getTime() + COMPETITION_RULES.submissionOnlyDays * DAY_MS);
}

export function getUnlockedVoteCount(startsAt: string | Date, now: Date = new Date()) {
  const votingStartsAt = getVotingStartsAt(startsAt);
  const elapsedVotingMs = now.getTime() - votingStartsAt.getTime();
  if (elapsedVotingMs < 0) return 0;
  const elapsedVotingDays = Math.floor(elapsedVotingMs / DAY_MS);
  return Math.min(
    COMPETITION_RULES.totalVotes,
    COMPETITION_RULES.initialVotes + Math.floor(elapsedVotingDays / COMPETITION_RULES.voteUnlockIntervalDays),
  );
}

export function getNextVoteUnlockAt(startsAt: string | Date, now: Date = new Date()) {
  const unlockedVotes = getUnlockedVoteCount(startsAt, now);
  if (unlockedVotes === 0) return getVotingStartsAt(startsAt);
  if (unlockedVotes >= COMPETITION_RULES.totalVotes) return null;
  const unlockNumber = unlockedVotes - COMPETITION_RULES.initialVotes + 1;
  return new Date(getVotingStartsAt(startsAt).getTime() + unlockNumber * COMPETITION_RULES.voteUnlockIntervalDays * DAY_MS);
}

export function getCompetitionTiming(competition: CompetitionWindow, now: Date = new Date()) {
  const startsAt = new Date(competition.startsAt);
  const endsAt = new Date(competition.endsAt);
  const votingStartsAt = getVotingStartsAt(startsAt);
  const elapsedMs = now.getTime() - startsAt.getTime();
  const elapsedDays = Math.floor(elapsedMs / DAY_MS);
  const totalDays = COMPETITION_RULES.submissionOnlyDays + COMPETITION_RULES.votingDays;
  let stage: CompetitionStage;

  if (competition.phase === "cancelled") stage = "cancelled";
  else if (competition.phase === "final") stage = "final";
  else if (competition.phase === "auditing" || now >= endsAt) stage = "review";
  else if (competition.phase === "draft" || competition.phase === "scheduled" || now < startsAt) stage = "upcoming";
  else if (now < votingStartsAt) stage = "submissions";
  else stage = "voting";

  return {
    stage,
    competitionDay: Math.max(1, Math.min(totalDays, elapsedDays + 1)),
    progressDays: stage === "upcoming"
      ? 0
      : stage === "review" || stage === "final"
        ? totalDays
        : Math.max(0, Math.min(totalDays, elapsedMs / DAY_MS)),
    votingStartsAt,
    unlockedVotes: getUnlockedVoteCount(startsAt, now),
    nextVoteUnlockAt: stage === "voting" ? getNextVoteUnlockAt(startsAt, now) : null,
    submissionsOpen: stage === "submissions" || stage === "voting",
    votingOpen: stage === "voting",
  };
}

export function getCompetitionStatus(competition: CompetitionWindow, now: Date = new Date()) {
  const timing = getCompetitionTiming(competition, now);
  if (timing.stage === "upcoming") return { ...timing, label: "Starts soon", tone: "neutral" as const, deadlineLabel: "Submissions open", deadlineAt: new Date(competition.startsAt) };
  if (timing.stage === "submissions") return { ...timing, label: "Submissions open", tone: "warning" as const, deadlineLabel: "Voting opens", deadlineAt: timing.votingStartsAt };
  if (timing.stage === "voting") return { ...timing, label: "Voting live", tone: "positive" as const, deadlineLabel: "Voting closes", deadlineAt: new Date(competition.endsAt) };
  if (timing.stage === "review") return { ...timing, label: "Final review", tone: "warning" as const, deadlineLabel: "Voting closed", deadlineAt: new Date(competition.endsAt) };
  if (timing.stage === "final") return { ...timing, label: "Results final", tone: "positive" as const, deadlineLabel: "Voting closed", deadlineAt: new Date(competition.endsAt) };
  return { ...timing, label: "Cancelled", tone: "danger" as const, deadlineLabel: "Competition ended", deadlineAt: new Date(competition.endsAt) };
}
