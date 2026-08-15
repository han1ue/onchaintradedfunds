import Link from "next/link";
import { ArrowRight, FileCheck2, History, Layers3 } from "lucide-react";
import { HowItWorks } from "@/components/HowItWorks";
import { CompetitionTimeline } from "@/components/CompetitionTimeline";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { MetricCard, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
import { COMPETITION_RULES, getCompetitionStatus } from "@/lib/competition";

function daysRemaining(endsAt: string) { return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)); }

export default async function HomePage() {
  const [competition, leaderboard, assets, session] = await Promise.all([getCompetition(), getLeaderboard(), getEligibleAssets(), auth()]);
  const eligibility = await getParticipationEligibility(session?.user, competition);
  const status = getCompetitionStatus(competition);
  const preview = competition.id.startsWith("preview");
  const leaderboardPreview = leaderboard.slice(0, 5);
  const recentProposals = [...leaderboard]
    .sort((left, right) => new Date(right.acceptedAt).getTime() - new Date(left.acceptedAt).getTime())
    .slice(0, 3);
  return <div className="pageShell homePage">
    <section className="competitionHero compactHero">
      <div><h1>Launch Competition</h1><div className="competitionStatus"><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{preview && <span>Preview data · not final</span>}</div></div>
      <div className="heroDeadline"><span>{status.deadlineLabel}</span><strong>{status.deadlineAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{daysRemaining(status.deadlineAt.toISOString())} days remaining</small></div>
    </section>
    <div className="metricsGrid">
      <MetricCard label="Votes cast" value={competition.voteCount.toLocaleString()} />
      <MetricCard label="OTF proposals" value={competition.proposalCount.toString()} />
      <MetricCard label="Supported RWAs" value={assets.length.toLocaleString()} href="/rwas" />
    </div>
    <CompetitionTimeline competition={competition} />
    <div className="boardGrid">
      <SectionCard className="leaderboardCard"><div className="cardHeading"><span>Live leaderboard</span><Link className="button buttonPrimary leaderboardSubmitButton" href="/submit">Submit OTF</Link></div>
        <ResponsiveLeaderboard entries={leaderboardPreview} final={competition.phase === "final"} />
        <div className="cardFooter leaderboardPreviewFooter"><span>{preview ? "Preview data shown — not final." : `Last updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span><Link href="/leaderboard">See full leaderboard <ArrowRight size={14} /></Link></div>
      </SectionCard>
      <HowItWorks eligibility={eligibility} />
    </div>
    <div className="lowerGrid">
      <SectionCard className="rulesPanel"><div className="cardHeading"><span>Competition rules</span><FileCheck2 size={18} /></div><ul><li>Use a verified, public X account with at least {competition.minFollowers.toLocaleString()} followers.</li><li>Include at least two eligible assets totaling exactly 100%.</li><li>Voting starts after the 7-day submission week with {COMPETITION_RULES.initialVotes} unlocked votes.</li><li>One vote unlocks every {COMPETITION_RULES.voteUnlockIntervalDays} voting days, up to {COMPETITION_RULES.totalVotes}; cast votes are final.</li><li>Creators may vote for their own proposal; final rank determines launch order.</li></ul><Link href="/rules">View all rules <ArrowRight size={14} /></Link></SectionCard>
      <SectionCard className="activityPanel"><div className="cardHeading"><span>Recent activity</span><History size={18} /></div><div className="participationActivity">{recentProposals.length ? recentProposals.map((proposal) => <div key={proposal.id}><Layers3 size={16} /><span className="activitySentence"><a href={`https://x.com/${encodeURIComponent(proposal.creator.username)}`} target="_blank" rel="noreferrer">@{proposal.creator.username}</a><span>proposed</span><Link href={`/otfs/${proposal.slug}`}>{proposal.name}</Link></span></div>) : <div><Layers3 size={16} /><span>No recent proposals yet.</span></div>}</div></SectionCard>
    </div>
  </div>;
}

