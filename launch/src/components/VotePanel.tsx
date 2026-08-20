import Link from "next/link";
import { Vote } from "lucide-react";
import type { ParticipationEligibility } from "@/lib/types";
import { EligibilityAction } from "./EligibilityGate";
import { SectionCard } from "./ui";

export function VotePanel({
  proposal,
  eligibility,
  totalVotes,
  allocatedVotes,
  castVotes,
  availability,
}: {
  proposal: { name: string; slug: string };
  eligibility: ParticipationEligibility;
  totalVotes: number;
  allocatedVotes: number;
  castVotes: number;
  availability: { votingOpen: boolean; unlockedVotes: number; votingStartsAt: string };
}) {
  const availableVotes = Math.max(0, availability.unlockedVotes - castVotes);
  return <SectionCard className="votePanel"><div className="otfVoteTotal"><span>OTF votes</span><strong>{totalVotes.toLocaleString()}</strong></div><div className="cardHeading"><div><span>Your votes</span><small>{availability.votingOpen ? `${availableVotes} available` : "Voting begins after the submission week"}</small></div><Vote size={19} /></div><div className="panelBody ballotCta">
    <div><strong>{!availability.votingOpen ? "Voting opens on competition day 8" : allocatedVotes > 0 ? `${allocatedVotes} locked ${allocatedVotes === 1 ? "vote" : "votes"}` : `Vote for ${proposal.name}`}</strong><p>{!availability.votingOpen ? `Three votes unlock at ${new Date(availability.votingStartsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. You can keep creating OTFs after voting opens.` : "Once cast, a vote cannot be moved or removed"}</p></div>
    {!availability.votingOpen
      ? <Link className="button buttonSecondary" href="/vote">See voting schedule</Link>
      : !eligibility.eligible
      ? <EligibilityAction eligibility={eligibility} action="vote" callbackUrl={`/vote?focus=${proposal.slug}`}>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction>
      : <Link className="button buttonPrimary" href={`/vote?focus=${proposal.slug}`}>{allocatedVotes > 0 ? "Cast more votes" : "Cast a vote"}</Link>}
  </div></SectionCard>;
}
