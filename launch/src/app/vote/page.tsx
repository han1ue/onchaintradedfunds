import { BallotPanel } from "@/components/BallotPanel";
import { COMPETITION_RULES, getCompetitionTiming } from "@/lib/competition";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

export const metadata = { title: "Cast your votes" };

export default async function VotePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const [competition, proposals, session, params] = await Promise.all([getCompetition(), getLeaderboard(), auth(), searchParams]);
  const timing = getCompetitionTiming(competition);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
  ]);
  const availability = { votingOpen: timing.votingOpen, unlockedVotes: timing.unlockedVotes, votingStartsAt: timing.votingStartsAt.toISOString(), nextVoteUnlockAt: timing.nextVoteUnlockAt?.toISOString() ?? null };
  return <div className="pageShell ballotPage"><header className="pageHeader ballotPageHeader"><h1>Cast your votes</h1><p>You begin with {COMPETITION_RULES.initialVotes} votes, then unlock one more every {COMPETITION_RULES.voteUnlockIntervalDays} voting days up to {COMPETITION_RULES.totalVotes}. Every voting action requires an X post, and you can cast several votes in one post while choosing whether to reveal your picks.</p></header><BallotPanel proposals={proposals} ballot={ballot} eligibility={eligibility} availability={availability} focusSlug={params.focus} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} /></div>;
}
