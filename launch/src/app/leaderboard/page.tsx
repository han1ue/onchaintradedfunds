import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { ResponsiveLeaderboard, VoterLeaderboard } from "@/components/Leaderboard";
import { SectionCard, StatusBadge } from "@/components/ui";
import { getCompetition, getLeaderboard, getVoterLeaderboard } from "@/server/data";
import { getCompetitionStatus } from "@/lib/competition";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "voters" ? "voters" : "otfs";
  const [competition, leaderboard, voters] = await Promise.all([getCompetition(), getLeaderboard(), getVoterLeaderboard()]);
  const preview = competition.id.startsWith("preview");
  const status = getCompetitionStatus(competition);

  return <div className="pageShell leaderboardPage">
    <section className="leaderboardPageHeader">
      <div>
        <h1>Leaderboard</h1>
        <p>Track OTF launch rank or compare verified voters by their latest Live or Final XP.</p>
      </div>
      <div className="leaderboardSummary">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span><Clock3 size={14} /> {status.deadlineLabel} {status.deadlineAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
    </section>
    <nav className="leaderboardViewTabs" aria-label="Leaderboard view">
      <Link href="/leaderboard" aria-current={view === "otfs" ? "page" : undefined}>OTF leaderboard</Link>
      <Link href="/leaderboard?view=voters" aria-current={view === "voters" ? "page" : undefined}>Voters &amp; XP</Link>
    </nav>
    <SectionCard className="leaderboardCard fullLeaderboardCard">
      {view === "otfs" ? <><div className="cardHeading"><div><span>All OTF proposals</span><small>{leaderboard.length} ranked {leaderboard.length === 1 ? "entry" : "entries"}</small></div><Link className="button buttonPrimary leaderboardSubmitButton" href="/submit">Submit OTF</Link></div><ResponsiveLeaderboard entries={leaderboard} final={competition.phase === "final"} /><div className="cardFooter"><span>{preview ? "Preview data shown — not final." : status.votingOpen ? "Rankings update whenever newly unlocked votes are cast." : "The board is accepting OTF submissions before voting opens."}</span><Link href="/rules#ranking-and-launch-order">How ranking works <ArrowRight size={14} /></Link></div></>
        : <><div className="cardHeading"><div><span>Voters ranked by XP</span><small>{voters.length} ranked {voters.length === 1 ? "participant" : "participants"}</small></div><Link className="button buttonSecondary leaderboardPrivacyButton" href="/me#voter-leaderboard-privacy">Manage my public name</Link></div><VoterLeaderboard entries={voters} /><div className="cardFooter"><span>{preview ? "Preview data shown. Names and XP are illustrative." : "Latest canonical XP determines rank. Generated aliases protect voter identity by default."}</span><Link href="/rules#live-xp">How XP works <ArrowRight size={14} /></Link></div></>}
    </SectionCard>
  </div>;
}
