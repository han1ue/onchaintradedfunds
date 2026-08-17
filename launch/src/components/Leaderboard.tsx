import Link from "next/link";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { BadgeCheck, Trophy } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/types";
import { truncateText } from "@/lib/truncate-text";
import { AllocationStrip } from "./AllocationStrip";
import { XProfileImage } from "./XProfileImage";
import { StatusBadge } from "./ui";

const LEADERBOARD_THESIS_LIMIT = 120;

function RankEmblem({ rank, role }: { rank: number; role?: "rowheader" }) {
  const podium = rank <= 3;
  return <div className={`rank rank${rank}${podium ? " podiumRank" : ""}`} role={role}>
    {podium && <svg className="rankWings" viewBox="0 0 58 34" aria-hidden="true">
      <path d="M23 27c-7-1-12-5-15-11M19 22c-5-2-8-5-10-9M17 17c-3-2-5-4-6-7M35 27c7-1 12-5 15-11M39 22c5-2 8-5 10-9M41 17c3-2 5-4 6-7" />
    </svg>}
    <span>{rank}</span>
  </div>;
}

export function ResponsiveLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  if (!entries.length) return <div className="leaderboardEmpty">
    <Trophy size={24} aria-hidden="true" />
    <div><strong>No OTF proposals yet</strong><p>Create the first OTF to start the leaderboard.</p></div>
    <Link className="button buttonPrimary" href="/submit">Create OTF</Link>
  </div>;

  return <div className="leaderboard">
    <div className="leaderboardHeader"><span>Rank</span><span>OTF</span><span>Portfolio</span><span>Creator</span><span>Votes</span></div>
    {entries.map((entry) => <Link className="leaderboardRow" href={`/otfs/${entry.slug}`} aria-label={`View ${entry.name} proposal details`} key={entry.id}>
      <RankEmblem rank={entry.rank} />
      <div className="otfIdentity">
        <OtfTokenIcon className="leaderboardOtfIcon" ticker={entry.ticker} size={40} />
        <div><div className="otfTitleLine"><span className="otfName">{entry.name}</span>{entry.quality === "high" && <StatusBadge tone="positive">Verified</StatusBadge>}</div><p title={entry.thesis}>{truncateText(entry.thesis, LEADERBOARD_THESIS_LIMIT)}</p></div>
      </div>
      <AllocationStrip allocations={entry.allocations} showPercentages />
      <div className="creator"><XProfileImage src={entry.creator.profileImageUrl} username={entry.creator.username} /><span>@{entry.creator.username}</span><BadgeCheck className="xVerifiedBadge" size={15} aria-label="Verified X account" /></div>
      <div className="voteTotal"><strong>{entry.votes.toLocaleString()}</strong></div>
    </Link>)}
  </div>;
}
