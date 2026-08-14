import Link from "next/link";
import { Vote } from "lucide-react";
import type { ParticipationEligibility } from "@/lib/types";
import { EligibilityAction } from "./EligibilityGate";
import { SectionCard } from "./ui";

export function VotePanel({
  proposal,
  eligibility,
  allocatedVotes,
}: {
  proposal: { name: string; slug: string };
  eligibility: ParticipationEligibility;
  allocatedVotes: number;
}) {
  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Your 100 votes</span><small>Distribute them across OTF proposals</small></div><Vote size={19} /></div><div className="panelBody ballotCta">
    <div><strong>{allocatedVotes > 0 ? `${allocatedVotes} votes allocated here` : `Allocate votes to ${proposal.name}`}</strong><p>Choose how many of your 100 votes this OTF should receive. You can change your distribution once every 24 hours.</p></div>
    {!eligibility.eligible
      ? <EligibilityAction eligibility={eligibility} action="vote" callbackUrl={`/vote?focus=${proposal.slug}`}>{eligibility.connected ? "Use another X account" : "Sign in to distribute votes"}</EligibilityAction>
      : <Link className="button buttonPrimary" href={`/vote?focus=${proposal.slug}`}>{allocatedVotes > 0 ? "Manage your votes" : "Distribute your votes"}</Link>}
  </div></SectionCard>;
}
