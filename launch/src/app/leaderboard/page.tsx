import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock3 } from "lucide-react";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { SectionCard, StatusBadge } from "@/components/ui";
import { getCompetition, getLeaderboard } from "@/server/data";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const [competition, leaderboard] = await Promise.all([getCompetition(), getLeaderboard()]);
  const preview = competition.id.startsWith("preview");

  return <div className="pageShell leaderboardPage">
    <section className="leaderboardPageHeader">
      <div>
        <h1>Live leaderboard</h1>
        <p>Every OTF proposal, ranked by votes allocated from community ballots.</p>
      </div>
      <div className="leaderboardSummary">
        <StatusBadge tone={competition.phase === "open" ? "positive" : "neutral"}>{competition.phase === "open" ? "Competition live" : competition.phase}</StatusBadge>
        <span><Clock3 size={14} /> Voting closes {new Date(competition.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
    </section>
    <SectionCard className="leaderboardCard fullLeaderboardCard">
      <div className="cardHeading"><div><span>All OTF proposals</span><small>{leaderboard.length} ranked {leaderboard.length === 1 ? "entry" : "entries"}</small></div><BadgeCheck size={18} /></div>
      <ResponsiveLeaderboard entries={leaderboard} final={competition.phase === "final"} />
      <div className="cardFooter"><span>{preview ? "Preview data shown — not final." : "Rankings update when voters redistribute their 100 votes."}</span><Link href="/rules#ranking-and-launch-order">How ranking works <ArrowRight size={14} /></Link></div>
    </SectionCard>
  </div>;
}
