import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { LeaderboardBrowser } from "@/components/LeaderboardBrowser";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { getCompetition, getLeaderboard } from "@/server/data";
import { getCompetitionStatus } from "@/lib/competition";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const [competition, leaderboardPage] = await Promise.all([getCompetition(), getLeaderboard()]);
  const preview = competition.id.startsWith("preview");
  const status = getCompetitionStatus(competition);

  return <div className="pageShell leaderboardPage">
    <section className="leaderboardPageHeader">
      <div>
        <h1>Leaderboard</h1>
        <p>Track the community ranking that becomes OTF launch order.</p>
      </div>
      <div className="leaderboardSummary">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span><Clock3 size={14} /> {status.deadlineLabel} {status.deadlineAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
    </section>
    <SectionCard className="leaderboardCard fullLeaderboardCard">
      <div className="cardHeading"><div><span>All OTF proposals</span><small>{competition.proposalCount} ranked {competition.proposalCount === 1 ? "entry" : "entries"}</small></div>{status.submissionsOpen && competition.proposalCount > 0 && <Button href="/submit" variant="secondary" className="leaderboardSubmitButton">Create OTF</Button>}</div>
      <LeaderboardBrowser initialPage={leaderboardPage} submissionsOpen={status.submissionsOpen} />
      <div className="cardFooter"><span>{preview ? "Preview data shown — not final." : status.votingOpen ? "Rankings update whenever newly unlocked votes are cast." : status.submissionsOpen ? "The board is accepting OTF submissions before voting opens." : "Competition inputs are locked for the final audit."}</span><Link href="/rules#ranking-and-launch-order">How ranking works <ArrowRight size={14} /></Link></div>
    </SectionCard>
  </div>;
}
