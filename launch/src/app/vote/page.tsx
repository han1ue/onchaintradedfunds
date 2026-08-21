import { BallotPanel } from "@/components/BallotPanel";
import { getCompetitionTiming } from "@/lib/competition";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

export const metadata = { title: "Cast your votes" };

export default async function VotePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const currentTime = new Date();
  const [competition, proposals, session, params] = await Promise.all([getCompetition(), getLeaderboard(), auth(), searchParams]);
  const timing = getCompetitionTiming(competition, currentTime);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
  ]);
  const availability = { votingOpen: timing.votingOpen, competitionEnded: timing.stage === "review" || timing.stage === "final" || timing.stage === "cancelled", unlockedVotes: timing.unlockedVotes, votingStartsAt: timing.votingStartsAt.toISOString(), nextVoteUnlockAt: timing.nextVoteUnlockAt?.toISOString() ?? null };
  return <div className="pageShell ballotPage"><header className="pageHeader ballotPageHeader"><h1>Cast your votes</h1><p>You begin with {competition.rules.initialVotes} votes, then unlock {competition.rules.votesPerUnlock} more every {competition.rules.voteUnlockIntervalDays} voting days up to {competition.rules.totalVotes}. Every voting action requires an X post, and you can cast several votes in one post while choosing whether or not to reveal your picks.</p></header><BallotPanel proposals={proposals} ballot={ballot} eligibility={eligibility} rules={competition.rules} availability={availability} focusSlug={params.focus} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} currentTime={currentTime.toISOString()} /></div>;
}
