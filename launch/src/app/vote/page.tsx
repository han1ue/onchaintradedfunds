import { BallotPanel } from "@/components/BallotPanel";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

export const metadata = { title: "Distribute your votes" };

export default async function VotePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const [competition, proposals, session, params] = await Promise.all([getCompetition(), getLeaderboard(), auth(), searchParams]);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
  ]);
  return <div className="pageShell ballotPage"><header className="pageHeader ballotPageHeader"><h1>Distribute your 100 votes</h1><p>Back one OTF or spread your votes across several proposals, including your own. Activate your ballot with one X post, then change the distribution once every 24 hours.</p></header><BallotPanel proposals={proposals} ballot={ballot} eligibility={eligibility} focusSlug={params.focus} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} /></div>;
}
