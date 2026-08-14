import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock3, FileCheck2, Layers3, Vote } from "lucide-react";
import { HowItWorks } from "@/components/HowItWorks";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { MetricCard, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";

function daysRemaining(endsAt: string) { return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)); }

function voterActivityLabel(count: number) {
  if (count === 0) return "No one has voted yet";
  return `${count.toLocaleString()} ${count === 1 ? "person has" : "people have"} voted`;
}

function proposalActivityLabel(count: number) {
  if (count === 0) return "No one has proposed an OTF yet";
  return `${count.toLocaleString()} ${count === 1 ? "person has" : "people have"} proposed an OTF`;
}

export default async function HomePage() {
  const [competition, leaderboard, assets, session] = await Promise.all([getCompetition(), getLeaderboard(), getEligibleAssets(), auth()]);
  const eligibility = await getParticipationEligibility(session?.user, competition);
  const preview = competition.id.startsWith("preview");
  const leaderboardPreview = leaderboard.slice(0, 5);
  return <div className="pageShell homePage">
    <section className="competitionHero compactHero">
      <div><h1>Launch Competition</h1><div className="competitionStatus"><StatusBadge tone={competition.phase === "open" ? "positive" : "neutral"}>{competition.phase === "open" ? "Competition live" : competition.phase}</StatusBadge><Link href="/rwas" className="rwasCountPill">{assets.length.toLocaleString()} supported RWAs</Link>{preview && <span>Preview data · not final</span>}</div></div>
      <div className="heroDeadline"><Clock3 size={17} /><span>Voting closes</span><strong>{new Date(competition.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{daysRemaining(competition.endsAt)} days remaining</small></div>
    </section>
    <div className="metricsGrid">
      <MetricCard label="Votes" value={competition.voteCount.toLocaleString()} />
      <MetricCard label="OTF proposals" value={competition.proposalCount.toString()} />
      <MetricCard label="Unique voters" value={competition.uniqueVoterCount.toLocaleString()} />
    </div>
    <div className="boardGrid">
      <SectionCard className="leaderboardCard"><div className="cardHeading"><span>Live leaderboard</span><BadgeCheck size={18} /></div>
        <ResponsiveLeaderboard entries={leaderboardPreview} final={competition.phase === "final"} />
        <div className="cardFooter leaderboardPreviewFooter"><span>{preview ? "Preview data shown — not final." : `Last updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span><Link href="/leaderboard">See full leaderboard <ArrowRight size={14} /></Link></div>
      </SectionCard>
      <HowItWorks eligibility={eligibility} />
    </div>
    <div className="lowerGrid">
      <SectionCard className="rulesPanel"><div className="cardHeading"><span>Competition rules</span><FileCheck2 size={18} /></div><ul><li>Use a verified, public X account with at least {competition.minFollowers.toLocaleString()} followers.</li><li>Include at least two eligible assets totaling exactly 100%.</li><li>Each eligible account distributes exactly 100 votes.</li><li>Activate your ballot with one public X post, then redistribute once every 24 hours.</li><li>Creators may vote for their own proposal; final rank determines launch order.</li></ul><Link href="/rules">View all rules <ArrowRight size={14} /></Link></SectionCard>
      <SectionCard className="activityPanel"><div className="cardHeading"><span>Competition activity</span><Vote size={18} /></div><div className="participationActivity"><div><Vote size={16} /><span>{voterActivityLabel(competition.uniqueVoterCount)}</span></div><div><Layers3 size={16} /><span>{proposalActivityLabel(competition.proposalCount)}</span></div></div></SectionCard>
    </div>
  </div>;
}

