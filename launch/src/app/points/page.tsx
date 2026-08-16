import { AlertTriangle, Clock3, DatabaseZap, Gauge, TrendingUp, UserRound, Users, Vote } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getUserXp, getXpLeaderboard } from "@/server/xp";

export const metadata = { title: "Live XP" };

function formatXp(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatTimestamp(value: string | null) {
  if (!value || new Date(value).getTime() === 0) return "Awaiting first run";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

export default async function PointsPage() {
  const session = await auth();
  const [xp, ownXp] = await Promise.all([getXpLeaderboard(), session?.user?.id ? getUserXp(session.user.id) : null]);
  const own = ownXp?.rows[0];
  return <div className="pageShell pointsPage">
    <header className="pointsHeader">
      <div><div className="pointsTitleLine"><h1>{xp.status === "final" ? "Final XP" : "Live XP"}</h1><StatusBadge tone={xp.status === "final" ? "positive" : "warning"}>{xp.status === "final" ? "Final" : "Provisional"}</StatusBadge></div><p>Ten million XP tracks voter performance, voting participation, and unique creator support—entirely separate from OTF launch order.</p></div>
      <div className="pointsRelease"><span>{xp.status === "final" ? "Final allocation" : "Released so far"}</span><strong>{formatXp(xp.released.total)} <small>XP</small></strong><small>{formatXp(xp.allocated.total)} currently allocated</small></div>
    </header>

    <div className="pointsMeta" aria-label="XP calculation timestamps">
      <span><Clock3 size={15} aria-hidden="true" />Calculated {formatTimestamp(xp.calculatedAt)} UTC</span>
      <span><DatabaseZap size={15} aria-hidden="true" />{xp.status === "final" ? `Final provider prices captured ${formatTimestamp(xp.priceCheckpointAt)} UTC` : "Performance settles from the final provider snapshot"}</span>
      <span>Policy {xp.policyVersion}</span>
    </div>

    <div className="xpPoolStrip">
      <SectionCard><TrendingUp size={18} aria-hidden="true" /><span>Performance</span><strong>{formatXp(xp.released.performance)}</strong><small>of 4,500,000 XP</small></SectionCard>
      <SectionCard><Vote size={18} aria-hidden="true" /><span>Participation</span><strong>{formatXp(xp.released.participation)}</strong><small>of 3,500,000 XP</small></SectionCard>
      <SectionCard><Users size={18} aria-hidden="true" /><span>Creator</span><strong>{formatXp(xp.released.creator)}</strong><small>of 2,000,000 XP</small></SectionCard>
    </div>

    {session?.user?.id && <SectionCard className="myXpSummary">
      <div className="myXpIdentity"><Gauge size={22} aria-hidden="true" /><div><span>Your {xp.status === "final" ? "Final" : "Live"} XP</span><strong>{formatXp(own?.totalXp ?? 0)} XP</strong></div></div>
      <dl><div><dt>Performance</dt><dd>{formatXp(own?.performanceXp ?? 0)}</dd></div><div><dt>Participation</dt><dd>{formatXp(own?.participationXp ?? 0)}</dd></div><div><dt>Creator</dt><dd>{formatXp(own?.creatorXp ?? 0)}</dd></div></dl>
      {own?.pendingTrancheCount ? <StatusBadge tone="warning">Awaiting final price · {own.pendingTrancheCount}</StatusBadge> : null}
    </SectionCard>}

    <SectionCard className="xpLeaderboardCard">
      <div className="xpTableIntro"><div><h2>Public XP leaderboard</h2><p>Exact integer allocations from the latest canonical calculation.</p></div><span>{xp.rows.length.toLocaleString()} participants</span></div>
      <div className="xpTable" role="table" aria-label="XP leaderboard">
        <div className="xpTableHeader" role="row"><span>Rank / participant</span><span>Performance</span><span>Participation</span><span>Creator</span><span>Supporters</span><span>Total XP</span></div>
        {xp.rows.length ? xp.rows.map((row, index) => <div className="xpTableRow" role="row" key={row.userId}>
          <div className="xpParticipant"><span className="xpRank">{index + 1}</span><span className="xpAliasAvatar" aria-hidden="true"><UserRound size={15} /></span><div><strong>{row.publicName}</strong><small>{row.usesRealUsername ? "Public X username" : "Generated alias"}</small></div></div>
          <span data-label="Performance">{formatXp(row.performanceXp)}{row.pendingTrancheCount > 0 && <small className="xpPending">Awaiting final price</small>}</span>
          <span data-label="Participation">{formatXp(row.participationXp)}</span>
          <span data-label="Creator">{formatXp(row.creatorXp)}{row.submissionBoost && <small className="xpBoost">Submission Week Boost · 1.5×</small>}</span>
          <span data-label="Supporters">{row.uniqueSupporterCount.toLocaleString()}</span>
          <strong data-label="Total XP">{formatXp(row.totalXp)}</strong>
          {(row.pendingTrancheCount > 0 || row.submissionBoost) && <div className="xpMobileStatuses">{row.pendingTrancheCount > 0 && <small className="xpPending">Awaiting final price</small>}{row.submissionBoost && <small className="xpBoost">Submission Week Boost · 1.5×</small>}</div>}
        </div>) : <div className="xpEmpty"><Gauge size={26} aria-hidden="true" /><strong>XP calculation is starting</strong><p>Verified participation will appear after the first calculation run.</p></div>}
      </div>
    </SectionCard>

    <Callout tone="warning"><AlertTriangle size={17} aria-hidden="true" /><span>{xp.status === "live" ? "Live XP includes participation and creator support; performance remains Pending until the final provider snapshot. " : "Final XP reflects the completed competition audit. "}XP has no guaranteed monetary value.</span></Callout>
  </div>;
}
