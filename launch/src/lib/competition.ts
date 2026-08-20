export const COMPETITION_IDENTITY = {
  slug: "genesis",
  name: "Genesis Competition",
} as const;

export type CompetitionRules = {
  minFollowers: number;
  minAccountAgeDays: number;
  minAssets: number;
  minAssetWeightBps: number;
  portfolioWeightBps: number;
  submissionOnlyDays: number;
  votingDays: number;
  initialVotes: number;
  votesPerUnlock: number;
  voteUnlockIntervalDays: number;
  totalVotes: number;
  maxProposalsPerAccount: number | null;
  eligibilityAllowlistBypasses: readonly ("verified" | "minFollowers")[];
};

export const COMPETITION_RULES = {
  minFollowers: 100,
  minAccountAgeDays: 30,
  minAssets: 2,
  minAssetWeightBps: 100,
  portfolioWeightBps: 10_000,
  submissionOnlyDays: 7,
  votingDays: 30,
  initialVotes: 3,
  votesPerUnlock: 1,
  voteUnlockIntervalDays: 3,
  totalVotes: 12,
  maxProposalsPerAccount: null,
  eligibilityAllowlistBypasses: ["verified", "minFollowers"],
} as const satisfies CompetitionRules;
export const COMPETITION_RULES_HASH = "5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9";

export const DAY_MS = 86_400_000;
export const COMPETITION_PROGRESS_INTERVAL_MS = 6 * 60 * 60 * 1_000;

type CompetitionWindow = {
  phase: "draft" | "scheduled" | "open" | "auditing" | "final" | "cancelled";
  startsAt: string | Date;
  endsAt: string | Date;
  rules?: CompetitionRules;
};

export type CompetitionStage = "upcoming" | "submissions" | "voting" | "review" | "final" | "cancelled";

export function isCompetitionUpcoming(startsAt: string | Date, now: Date = new Date()) {
  return now.getTime() < new Date(startsAt).getTime();
}

export function getVotingStartsAt(startsAt: string | Date, rules: CompetitionRules = COMPETITION_RULES) {
  return new Date(new Date(startsAt).getTime() + rules.submissionOnlyDays * DAY_MS);
}

export function getUnlockedVoteCount(startsAt: string | Date, now: Date = new Date(), rules: CompetitionRules = COMPETITION_RULES) {
  const votingStartsAt = getVotingStartsAt(startsAt, rules);
  const elapsedVotingMs = now.getTime() - votingStartsAt.getTime();
  if (elapsedVotingMs < 0) return 0;
  const elapsedVotingDays = Math.floor(elapsedVotingMs / DAY_MS);
  return Math.min(
    rules.totalVotes,
    rules.initialVotes + Math.floor(elapsedVotingDays / rules.voteUnlockIntervalDays) * rules.votesPerUnlock,
  );
}

export function getNextVoteUnlockAt(startsAt: string | Date, now: Date = new Date(), rules: CompetitionRules = COMPETITION_RULES) {
  const unlockedVotes = getUnlockedVoteCount(startsAt, now, rules);
  if (unlockedVotes === 0) return getVotingStartsAt(startsAt, rules);
  if (unlockedVotes >= rules.totalVotes) return null;
  const completedUnlocks = Math.floor((unlockedVotes - rules.initialVotes) / rules.votesPerUnlock);
  return new Date(getVotingStartsAt(startsAt, rules).getTime() + (completedUnlocks + 1) * rules.voteUnlockIntervalDays * DAY_MS);
}

export function getCompetitionTiming(competition: CompetitionWindow, now: Date = new Date()) {
  const rules = competition.rules ?? COMPETITION_RULES;
  const startsAt = new Date(competition.startsAt);
  const endsAt = new Date(competition.endsAt);
  const votingStartsAt = getVotingStartsAt(startsAt, rules);
  const elapsedMs = now.getTime() - startsAt.getTime();
  const elapsedDays = Math.floor(elapsedMs / DAY_MS);
  const totalDays = rules.submissionOnlyDays + rules.votingDays;
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
        : Math.max(0, Math.min(totalDays, Math.ceil(elapsedMs / COMPETITION_PROGRESS_INTERVAL_MS) * COMPETITION_PROGRESS_INTERVAL_MS / DAY_MS)),
    votingStartsAt,
    unlockedVotes: getUnlockedVoteCount(startsAt, now, rules),
    nextVoteUnlockAt: stage === "voting" ? getNextVoteUnlockAt(startsAt, now, rules) : null,
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
