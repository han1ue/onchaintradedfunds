import { notFound } from "next/navigation";
import { BadgeCheck, Users } from "lucide-react";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { AllocationStrip } from "@/components/AllocationStrip";
import { VotePanel } from "@/components/VotePanel";
import { XPostEmbed } from "@/components/XPostEmbed";
import { XProfileImage } from "@/components/XProfileImage";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getProposal } from "@/server/data";
import { getCompetition } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
import { getXEmbedHtml } from "@/server/x";
import { getCompetitionTiming } from "@/lib/competition";
import { formatProposalAge } from "@/lib/relative-time";
import { pricingConfigSummary } from "@/lib/pricing-config";

export default async function ProposalPage({ params }: { params: Promise<{ slug: string }> }) {
  const [proposal, session, competition] = await Promise.all([getProposal((await params).slug), auth(), getCompetition()]);
  if (!proposal) notFound();
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
  ]);
  const allocatedVotes = ballot?.allocations.find((allocation) => allocation.proposalId === proposal.id)?.votes ?? 0;
  const timing = getCompetitionTiming(competition);
  const proposedAt = new Date(proposal.acceptedAt);
  const submissionEmbedHtml = proposal.proofUrl ? await getXEmbedHtml(proposal.proofUrl).catch(() => undefined) : undefined;
  return <div className="pageShell proposalPage"><section className="proposalHero"><div className="proposalTitle"><OtfTokenIcon ticker={proposal.ticker} size={64} /><div><h1>{proposal.name}</h1><div className="proposalMeta"><StatusBadge tone="positive">Rank #{proposal.rank}</StatusBadge><StatusBadge tone={proposal.quality === "high" ? "positive" : "neutral"}>{proposal.quality === "high" ? "Verified" : "Non-verified"}</StatusBadge><span>{proposal.votes.toLocaleString()} votes</span><span><Users size={14} aria-hidden="true" />{(proposal.uniqueSupporterCount ?? 0).toLocaleString()} unique supporters</span><time dateTime={proposedAt.toISOString()} title={proposedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}>{formatProposalAge(proposedAt)}</time></div></div></div><div className="creatorBlock"><span>Created by</span><strong><XProfileImage src={proposal.creator.profileImageUrl} username={proposal.creator.username} size={30} />@{proposal.creator.username}<BadgeCheck className="xVerifiedBadge" size={16} aria-label="Verified X account" /></strong></div></section>
    <Callout>{proposal.quality === "high"
      ? <><strong>Verified OTF.</strong> Every constituent is currently verified, so votes for this OTF compete for the 3,500,000 XP verified-performance pool.</>
      : <><strong>Non-verified OTF.</strong> At least one constituent is not currently verified, so votes for this OTF compete for the 1,500,000 XP non-verified-performance pool.</>}
    </Callout>
    <div className="proposalGrid"><div><SectionCard className="contentCard"><h2>Investment thesis</h2><p className="thesisLong">{proposal.thesis}</p></SectionCard><SectionCard className="contentCard"><h2>Performance scoring</h2><p className="thesisLong">Each vote tranche uses provider USD prices captured when that tranche is cast and once when the competition ends. There is no live return price series; missing entry or final prices leave that tranche Pending.</p></SectionCard><SectionCard className="contentCard"><h2>Portfolio allocation</h2><AllocationStrip allocations={proposal.allocations} showLabels={false} /><div className="allocationTable">{proposal.allocations.map((allocation) => <div key={allocation.assetId}><div><span className="assetDot" /><strong>{allocation.symbol}</strong><small>{allocation.name}</small>{allocation.contractAddress && <code>{allocation.contractAddress}</code>}{allocation.pricingConfig && <code>{pricingConfigSummary(allocation.pricingConfig)}</code>}</div><span>{allocation.weightBps / 100}%</span></div>)}</div></SectionCard></div><div><VotePanel proposal={{ name: proposal.name, slug: proposal.slug }} eligibility={eligibility} allocatedVotes={allocatedVotes} availability={{ votingOpen: timing.votingOpen, unlockedVotes: timing.unlockedVotes, votingStartsAt: timing.votingStartsAt.toISOString() }} />{submissionEmbedHtml && <XPostEmbed html={submissionEmbedHtml} />}</div></div>
  </div>;
}
