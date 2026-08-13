import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { AllocationStrip } from "@/components/AllocationStrip";
import { VotePanel } from "@/components/VotePanel";
import { XPostEmbed } from "@/components/XPostEmbed";
import { SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getProposal } from "@/server/data";
import { getXEmbedHtml } from "@/server/x";

export default async function ProposalPage({ params }: { params: Promise<{ slug: string }> }) {
  const [proposal, session] = await Promise.all([getProposal((await params).slug), auth()]);
  if (!proposal) notFound();
  const submissionEmbedHtml = proposal.proofUrl ? await getXEmbedHtml(proposal.proofUrl).catch(() => undefined) : undefined;
  return <div className="pageShell proposalPage"><section className="proposalHero"><div className="proposalTitle"><OtfTokenIcon ticker={proposal.ticker} size={64} /><div><h1>{proposal.name}</h1><div className="proposalMeta"><StatusBadge tone="positive">Rank #{proposal.rank}</StatusBadge><span>{proposal.votes.toLocaleString()} verified votes</span></div></div></div><div className="creatorBlock"><span>Created by</span><strong>@{proposal.creator.username}<BadgeCheck size={16} /></strong></div></section>
    <div className="proposalGrid"><div><SectionCard className="contentCard"><h2>Investment thesis</h2><p className="thesisLong">{proposal.thesis}</p></SectionCard><SectionCard className="contentCard"><h2>Portfolio allocation</h2><AllocationStrip allocations={proposal.allocations} showPercentages /><div className="allocationTable">{proposal.allocations.map((allocation) => <div key={allocation.assetId}><div><span className="assetDot" /><strong>{allocation.symbol}</strong><small>{allocation.name}</small></div><span>{allocation.weightBps / 100}%</span></div>)}</div><p className="eligibilityNote"><BadgeCheck size={15} /> Eligibility was checked against a direct Robinhood Chain Uniswap V3 RWA/USDG pool when submitted.</p></SectionCard></div><div><VotePanel proposal={{ id: proposal.id, name: proposal.name, ticker: proposal.ticker, slug: proposal.slug }} connected={Boolean(session?.user)} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} />{proposal.proofUrl && <SectionCard className="evidencePanel"><div className="cardHeading"><div><span>Submission evidence</span><small>Verified public X post</small></div><BadgeCheck size={18} /></div><XPostEmbed html={submissionEmbedHtml} postUrl={proposal.proofUrl} /></SectionCard>}</div></div>
  </div>;
}
