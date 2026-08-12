import Link from "next/link";
import { BadgeCheck, ChevronRight } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/types";
import { AllocationStrip } from "./AllocationStrip";
import { ProposalMark } from "./BrandMark";

function RankEmblem({ rank }: { rank: number }) {
  const podium = rank <= 3;
  return <div className={`rank rank${rank}${podium ? " podiumRank" : ""}`}>
    {podium && <svg className="rankWings" viewBox="0 0 58 34" aria-hidden="true">
      <path d="M23 27c-7-1-12-5-15-11M19 22c-5-2-8-5-10-9M17 17c-3-2-5-4-6-7M35 27c7-1 12-5 15-11M39 22c5-2 8-5 10-9M41 17c3-2 5-4 6-7" />
    </svg>}
    <span>{rank}</span>
  </div>;
}

export function ResponsiveLeaderboard({ entries, final = false }: { entries: LeaderboardEntry[]; final?: boolean }) {
  return <div className="leaderboard">
    <div className="leaderboardHeader"><span>Rank</span><span>OTF identity & thesis</span><span>Portfolio</span><span>Creator</span><span>{final ? "Final votes" : "Verified votes"}</span></div>
    {entries.map((entry) => <article className="leaderboardRow" key={entry.id}>
      <RankEmblem rank={entry.rank} />
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
