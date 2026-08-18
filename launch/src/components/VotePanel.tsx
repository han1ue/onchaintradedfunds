import Link from "next/link";
import { Vote } from "lucide-react";
import type { ParticipationEligibility } from "@/lib/types";
import { EligibilityAction } from "./EligibilityGate";
import { SectionCard } from "./ui";

export function VotePanel({
  proposal,
  eligibility,
  allocatedVotes,
  availability,
}: {
  proposal: { name: string; slug: string };
  eligibility: ParticipationEligibility;
  allocatedVotes: number;
  availability: { votingOpen: boolean; unlockedVotes: number; votingStartsAt: string };
}) {
  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Your votes</span><small>{availability.votingOpen ? `${availability.unlockedVotes} unlocked now · 12 maximum` : "Voting begins after the submission week"}</small></div><Vote size={19} /></div><div className="panelBody ballotCta">
    <div><strong>{!availability.votingOpen ? "Voting opens on competition day 8" : allocatedVotes > 0 ? `${allocatedVotes} locked ${allocatedVotes === 1 ? "vote" : "votes"}` : `Vote for ${proposal.name}`}</strong><p>{availability.votingOpen ? "Cast any newly unlocked votes you want this OTF to receive. Once cast, a vote cannot be moved or removed." : `Three votes unlock at ${new Date(availability.votingStartsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. You can keep creating OTFs after voting opens.`}</p></div>
    {!availability.votingOpen
      ? <Link className="button buttonSecondary" href="/vote">See voting schedule</Link>
      : !eligibility.eligible
      ? <EligibilityAction eligibility={eligibility} action="vote" callbackUrl={`/vote?focus=${proposal.slug}`}>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction>
      : <Link className="button buttonPrimary" href={`/vote?focus=${proposal.slug}`}>{allocatedVotes > 0 ? "Cast more votes" : "Cast a vote"}</Link>}
  </div></SectionCard>;
}
