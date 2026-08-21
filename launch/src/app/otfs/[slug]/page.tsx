import { notFound } from "next/navigation";
import { BadgeCheck, CircleAlert, ExternalLink } from "lucide-react";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { AllocationStrip, allocationColor } from "@/components/AllocationStrip";
import { VotePanel } from "@/components/VotePanel";
import { XPostEmbed } from "@/components/XPostEmbed";
import { XProfileImage } from "@/components/XProfileImage";
import { PortfolioReturnsChart } from "@/components/PortfolioReturnsChart";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getBallotSummary } from "@/server/ballot";
import { getInvalidProposal, getProposal } from "@/server/data";
import { getCompetition } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
import { getXEmbedHtml } from "@/server/x";
import { getCompetitionTiming } from "@/lib/competition";
import { shortAddress } from "@/lib/format-address";
import { formatProposalAge } from "@/lib/relative-time";
import { pricingConfigSummary } from "@/lib/pricing-config";
import { getProposalReturns } from "@/server/prices";

function InvalidProposalState({ proposal }: {
  proposal: { name: string; ticker: string; votes: number; creator: { username: string; profileImageUrl?: string | null } };
}) {
  return <div className="pageShell proposalInvalidPage"><section className="proposalInvalidState" role="alert"><CircleAlert size={38} aria-hidden="true" /><StatusBadge tone="danger">Voting unavailable</StatusBadge><h1>Tweet not found</h1><p>The creator deleted the required X submission post, so this OTF can no longer receive votes.</p><div className="invalidProposalIdentity"><OtfTokenIcon ticker={proposal.ticker} size={44} /><div><strong>{proposal.name}</strong><span><XProfileImage src={proposal.creator.profileImageUrl} username={proposal.creator.username} size={22} />@{proposal.creator.username}</span></div></div><p className="invalidProposalVotes">{proposal.votes > 0 ? `${proposal.votes.toLocaleString()} ${proposal.votes === 1 ? "vote was" : "votes were"} cast for this OTF. Those votes remain spent, cannot be reassigned, and will not count toward XP.` : "No votes were cast for this OTF."}</p></section></div>;
}

export default async function ProposalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [proposal, session, competition] = await Promise.all([getProposal(slug), auth(), getCompetition()]);
  if (!proposal) {
    const invalidProposal = await getInvalidProposal(slug);
    if (!invalidProposal) notFound();
    return <InvalidProposalState proposal={invalidProposal} />;
  }
  const [eligibility, ballot, portfolioReturns] = await Promise.all([
    getParticipationEligibility(session?.user, competition),
    session?.user.id ? getBallotSummary(competition.id, session.user.id) : null,
    getProposalReturns(proposal.id, proposal.acceptedAt, proposal.allocations).catch(() => ({ proposedAt: proposal.acceptedAt, trackingStartedAt: null, points: [] })),
  ]);
  const allocatedVotes = ballot?.allocations.find((allocation) => allocation.proposalId === proposal.id)?.votes ?? 0;
  const castVotes = ballot?.status === "valid" ? ballot.allocations.reduce((total, allocation) => total + allocation.votes, 0) : 0;
  const currentTime = new Date();
  const timing = getCompetitionTiming(competition, currentTime);
  const proposedAt = new Date(proposal.acceptedAt);
  let submissionEmbedHtml: string | undefined;
  let submissionPostDeleted = false;
  if (proposal.proofUrl) {
    try {
      submissionEmbedHtml = await getXEmbedHtml(proposal.proofUrl);
    } catch (error) {
      submissionPostDeleted = error instanceof Error && error.message === "X_POST_NOT_FOUND";
    }
  }
  if (submissionPostDeleted) return <InvalidProposalState proposal={proposal} />;
  return <div className="pageShell proposalPage"><section className="proposalHero"><div className="proposalTitle"><OtfTokenIcon ticker={proposal.ticker} size={64} /><div><h1>{proposal.name}</h1><div className="proposalMeta"><StatusBadge tone="positive">Rank #{proposal.rank}</StatusBadge><StatusBadge tone={proposal.quality === "high" ? "positive" : "neutral"}>{proposal.quality === "high" ? "Verified" : "Non-verified"}</StatusBadge><time dateTime={proposedAt.toISOString()} title={proposedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}>{formatProposalAge(proposedAt)}</time></div></div></div><div className="creatorBlock"><span>Created by</span><strong><XProfileImage src={proposal.creator.profileImageUrl} username={proposal.creator.username} size={30} />@{proposal.creator.username}<BadgeCheck className="xVerifiedBadge" size={16} aria-label="Verified X account" /></strong></div></section>
    <Callout>{proposal.quality === "high"
      ? <><strong>Verified OTF.</strong> Every constituent is currently verified, so votes for this OTF compete for the 3,500,000 XP verified-performance pool.</>
      : <><strong>Non-verified OTF.</strong> At least one constituent is not currently verified, so votes for this OTF compete for the 1,750,000 XP non-verified-performance pool.</>}
    </Callout>
    <div className="proposalGrid"><div><SectionCard className="contentCard"><h2>Investment thesis</h2><p className="thesisLong">{proposal.thesis}</p></SectionCard><SectionCard className="contentCard portfolioCard"><PortfolioReturnsChart returns={portfolioReturns} preview={competition.id.startsWith("preview")} /><div className="portfolioAllocationSection"><h2>Allocation</h2><AllocationStrip allocations={proposal.allocations} showLabels={false} /><div className="allocationTable">{proposal.allocations.map((allocation, index) => <div key={allocation.assetId}><div><span className="assetDot" style={{ background: allocationColor(allocation, index) }} /><strong>{allocation.symbol}</strong><small>{allocation.name}</small>{allocation.contractAddress && <a className="allocationAddress" href={`https://robinhoodchain.blockscout.com/address/${allocation.contractAddress}`} target="_blank" rel="noreferrer" title={`${allocation.contractAddress} · View ${allocation.symbol} token on Robinhood Chain explorer`}><code>{shortAddress(allocation.contractAddress)}</code><ExternalLink size={12} aria-hidden="true" /></a>}{allocation.pricingConfig && <code>{pricingConfigSummary(allocation.pricingConfig)}</code>}</div><span>{allocation.weightBps / 100}%</span></div>)}</div></div></SectionCard></div><div><VotePanel proposal={{ name: proposal.name, slug: proposal.slug }} eligibility={eligibility} totalVotes={proposal.votes} allocatedVotes={allocatedVotes} castVotes={castVotes} availability={{ votingOpen: timing.votingOpen, unlockedVotes: timing.unlockedVotes, votingStartsAt: timing.votingStartsAt.toISOString() }} />{submissionEmbedHtml && <XPostEmbed html={submissionEmbedHtml} />}</div></div>
  </div>;
}
