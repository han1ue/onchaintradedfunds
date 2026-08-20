import { BallotPanel } from "@/components/BallotPanel";
import { COMPETITION_RULES, getCompetitionTiming } from "@/lib/competition";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

export const metadata = { title: "Cast your votes" };

export default async function VotePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const currentTime = new Date();
  const [competition, proposals, session, params, requestHeaders] = await Promise.all([getCompetition(), getLeaderboard(), auth(), searchParams, headers()]);
  const timing = getCompetitionTiming(competition, currentTime);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
  ]);
  const availability = { votingOpen: timing.votingOpen, competitionEnded: timing.stage === "review" || timing.stage === "final" || timing.stage === "cancelled", unlockedVotes: timing.unlockedVotes, votingStartsAt: timing.votingStartsAt.toISOString(), nextVoteUnlockAt: timing.nextVoteUnlockAt?.toISOString() ?? null };
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto") ?? (forwardedHost?.startsWith("localhost") ? "http" : "https");
  const siteUrl = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  return <div className="pageShell ballotPage"><header className="pageHeader ballotPageHeader"><h1>Cast your votes</h1><p>You begin with {COMPETITION_RULES.initialVotes} votes, then unlock one more every {COMPETITION_RULES.voteUnlockIntervalDays} voting days up to {COMPETITION_RULES.totalVotes}. Every voting action requires an X post, and you can cast several votes in one post while choosing whether or not to reveal your picks.</p></header><BallotPanel proposals={proposals} ballot={ballot} eligibility={eligibility} availability={availability} focusSlug={params.focus} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={siteUrl} currentTime={currentTime.toISOString()} /></div>;
}
