import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { SectionCard, StatusBadge } from "@/components/ui";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getCompetitionStatus } from "@/lib/competition";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const [competition, leaderboard] = await Promise.all([getCompetition(), getLeaderboard()]);
  const preview = competition.id.startsWith("preview");
  const status = getCompetitionStatus(competition);

  return <div className="pageShell leaderboardPage">
    <section className="leaderboardPageHeader">
      <div>
        <h1>Live leaderboard</h1>
        <p>Every OTF proposal, ranked by votes allocated from community ballots.</p>
      </div>
      <div className="leaderboardSummary">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span><Clock3 size={14} /> {status.deadlineLabel} {status.deadlineAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
    </section>
    <SectionCard className="leaderboardCard fullLeaderboardCard">
      <div className="cardHeading"><div><span>All OTF proposals</span><small>{leaderboard.length} ranked {leaderboard.length === 1 ? "entry" : "entries"}</small></div><Link className="button buttonPrimary leaderboardSubmitButton" href="/submit">Submit OTF</Link></div>
      <ResponsiveLeaderboard entries={leaderboard} final={competition.phase === "final"} />
      <div className="cardFooter"><span>{preview ? "Preview data shown — not final." : status.votingOpen ? "Rankings update whenever newly unlocked votes are cast." : "The board is accepting OTF submissions before voting opens."}</span><Link href="/rules#ranking-and-launch-order">How ranking works <ArrowRight size={14} /></Link></div>
    </SectionCard>
  </div>;
}
