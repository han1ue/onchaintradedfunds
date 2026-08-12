import Link from "next/link";
import { BadgeCheck, ChevronRight } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/types";
import { AllocationStrip } from "./AllocationStrip";
import { ProposalMark } from "./BrandMark";

export function ResponsiveLeaderboard({ entries, final = false }: { entries: LeaderboardEntry[]; final?: boolean }) {
  return <div className="leaderboard">
    <div className="leaderboardHeader"><span>Rank</span><span>OTF identity & thesis</span><span>Portfolio</span><span>Creator</span><span>{final ? "Final votes" : "Verified votes"}</span></div>
    {entries.map((entry) => <article className="leaderboardRow" key={entry.id}>
      <div className={`rank rank${entry.rank}`}><span>{entry.rank}</span></div>
      <div className="otfIdentity">
        <ProposalMark ticker={entry.ticker} />
        <div><Link href={`/otfs/${entry.slug}`}>{entry.name}<ChevronRight size={14} /></Link><span className="ticker">${entry.ticker}</span><p>{entry.thesis}</p></div>
      </div>
      <AllocationStrip allocations={entry.allocations} />
      <div className="creator"><span>@{entry.creator.username}</span><BadgeCheck size={15} aria-label="Verified X creator" /></div>
      <div className="voteTotal"><strong>{entry.votes.toLocaleString()}</strong><span>verified</span></div>
    </article>)}
  </div>;
}
