import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock3, FileCheck2, Trophy, Vote } from "lucide-react";
import { HowItWorks } from "@/components/HowItWorks";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { MetricCard, SectionCard, StatusBadge } from "@/components/ui";
import { launchAssets } from "@/lib/launch-assets";
import { auth } from "@/server/auth";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

function daysRemaining(endsAt: string) { return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)); }

export default async function HomePage() {
  const [competition, leaderboard, session] = await Promise.all([getCompetition(), getLeaderboard(), auth()]);
  const eligibility = await getParticipationEligibility(session?.user, competition);
  const preview = competition.id.startsWith("preview");
  const leaderboardPreview = leaderboard.slice(0, 5);
  return <div className="pageShell homePage">
    <section className="competitionHero compactHero">
      <div><h1>Launch Competition</h1><div className="competitionStatus"><StatusBadge tone={competition.phase === "open" ? "positive" : "neutral"}>{competition.phase === "open" ? "Competition live" : competition.phase}</StatusBadge><StatusBadge href="/rwas">{launchAssets.length.toLocaleString()} supported RWAs</StatusBadge>{preview && <span>Preview data · not final</span>}</div></div>
      <div className="heroDeadline"><Clock3 size={17} /><span>Voting closes</span><strong>{new Date(competition.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{daysRemaining(competition.endsAt)} days remaining</small></div>
    </section>
    <div className="metricsGrid">
      <MetricCard label="Verified votes" value={competition.verifiedVoteCount.toLocaleString()} />
      <MetricCard label="OTF proposals" value={competition.proposalCount.toString()} />
      <MetricCard label="Unique voters" value={competition.uniqueVoterCount.toLocaleString()} />
    </div>
    <div className="boardGrid">
      <SectionCard className="leaderboardCard"><div className="cardHeading"><div><span>Live leaderboard</span><small>Final rank becomes launch order</small></div><BadgeCheck size={18} /></div>
        <ResponsiveLeaderboard entries={leaderboardPreview} final={competition.phase === "final"} />
        <div className="cardFooter leaderboardPreviewFooter"><span>{preview ? "Preview data shown — not final." : `Last updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span><Link href="/leaderboard">See full leaderboard <ArrowRight size={14} /></Link></div>
      </SectionCard>
      <HowItWorks eligibility={eligibility} />
    </div>
    <div className="lowerGrid">
      <SectionCard className="rulesPanel"><div className="cardHeading"><div><span>Competition rules</span><small>The V1 essentials</small></div><FileCheck2 size={18} /></div><ul><li>Verified, public X accounts with at least {competition.minFollowers.toLocaleString()} followers.</li><li>At least two eligible assets totaling exactly 100%.</li><li>Approve one public X post for every submission and vote.</li><li>One vote per account per OTF; no self-votes.</li><li>Final rank directly determines launch order.</li></ul><Link href="/rules">View all rules <ArrowRight size={14} /></Link></SectionCard>
      <SectionCard className="activityPanel"><div className="cardHeading"><div><span>Recent activity</span><small>Verified community actions</small></div><Vote size={18} /></div><div className="recentActivity">{leaderboard.slice(0, 4).map((entry, index) => <div key={entry.id}>{index === 0 ? <Trophy size={16} /> : <BadgeCheck size={16} />}<span><strong>@{entry.creator.username}</strong> {index % 2 ? `submitted ${entry.name}` : `reached ${entry.votes.toLocaleString()} verified votes`}</span><small>{index * 7 + 2}m ago</small></div>)}</div></SectionCard>
    </div>
  </div>;
}
