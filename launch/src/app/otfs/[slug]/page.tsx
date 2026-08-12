import { notFound } from "next/navigation";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { AllocationStrip } from "@/components/AllocationStrip";
import { OtfTokenIcon } from "@/components/BrandMark";
import { VotePanel } from "@/components/VotePanel";
import { SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getProposal } from "@/server/data";

export default async function ProposalPage({ params }: { params: Promise<{ slug: string }> }) {
  const [proposal, session] = await Promise.all([getProposal((await params).slug), auth()]);
  if (!proposal) notFound();
  return <div className="pageShell proposalPage"><section className="proposalHero"><div className="proposalTitle"><OtfTokenIcon ticker={proposal.ticker} size={64} /><div><div className="eyebrow"><StatusBadge tone="positive">Rank #{proposal.rank}</StatusBadge><span>{proposal.votes.toLocaleString()} verified votes</span></div><h1>{proposal.name}</h1><p>${proposal.ticker}</p></div></div><div className="creatorBlock"><span>Created by</span><strong>@{proposal.creator.username}<BadgeCheck size={16} /></strong></div></section>
    <div className="proposalGrid"><div><SectionCard className="contentCard"><h2>Investment thesis</h2><p className="thesisLong">{proposal.thesis}</p></SectionCard><SectionCard className="contentCard"><h2>Portfolio allocation</h2><AllocationStrip allocations={proposal.allocations} showPercentages /><div className="allocationTable">{proposal.allocations.map((allocation) => <div key={allocation.assetId}><div><span className="assetDot" /><strong>{allocation.symbol}</strong><small>{allocation.name}</small></div><span>{allocation.weightBps / 100}%</span></div>)}</div><p className="eligibilityNote"><BadgeCheck size={15} /> Eligibility was checked against a direct Robinhood Chain Uniswap V3 RWA/USDG pool when submitted.</p></SectionCard></div><div><VotePanel proposalId={proposal.id} connected={Boolean(session?.user)} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />{proposal.proofUrl && <a className="proofLink" href={proposal.proofUrl} target="_blank" rel="noreferrer">View submission proof <ExternalLink size={13} /></a>}</div></div>
  </div>;
}
