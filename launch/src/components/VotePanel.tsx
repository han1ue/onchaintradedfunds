"use client";

import Link from "next/link";
import { Clock3, Vote } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParticipationEligibility } from "@/lib/types";
import { formatProposalVoteCountdown, getProposalVotingStartsAt, isProposalVotingOpen } from "@/lib/proposal-voting";
import { EligibilityAction } from "./EligibilityGate";
import { SectionCard } from "./ui";

export function VotePanel({
  proposal,
  eligibility,
  totalVotes,
  allocatedVotes,
  castVotes,
  availability,
  currentTime,
}: {
  proposal: { name: string; slug: string; acceptedAt: string };
  eligibility: ParticipationEligibility;
  totalVotes: number;
  allocatedVotes: number;
  castVotes: number;
  availability: { votingOpen: boolean; unlockedVotes: number; votingStartsAt: string };
  currentTime: string;
}) {
  const [nowMs, setNowMs] = useState(() => new Date(currentTime).getTime());
  const proposalVotingOpen = isProposalVotingOpen(proposal.acceptedAt, nowMs);
  useEffect(() => {
    if (proposalVotingOpen) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [proposalVotingOpen]);
  const availableVotes = Math.max(0, availability.unlockedVotes - castVotes);
  const countdown = formatProposalVoteCountdown(proposal.acceptedAt, nowMs);
  const proposalVotingStartsAt = getProposalVotingStartsAt(proposal.acceptedAt);
  return <SectionCard className="votePanel"><div className="otfVoteTotal"><span>OTF votes</span><strong>{totalVotes.toLocaleString()}</strong></div><div className="cardHeading"><div><span>Your votes</span><small>{availability.votingOpen ? `${availableVotes} available` : "Voting begins after the submission week"}</small></div><Vote size={19} /></div><div className="panelBody ballotCta">
    <div><strong>{!availability.votingOpen ? "Voting opens on competition day 8" : !proposalVotingOpen ? "Price checkpoint pending" : allocatedVotes > 0 ? `${allocatedVotes} locked ${allocatedVotes === 1 ? "vote" : "votes"}` : `Vote for ${proposal.name}`}</strong><p>{!availability.votingOpen ? `Three votes unlock at ${new Date(availability.votingStartsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. You can keep creating OTFs after voting opens.` : !proposalVotingOpen ? `This new OTF becomes votable at ${proposalVotingStartsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })}, after its 30-minute checkpoint window.` : "Once cast, a vote cannot be moved or removed"}</p></div>
    {!availability.votingOpen
      ? <Link className="button buttonSecondary" href="/vote">See voting schedule</Link>
      : !proposalVotingOpen
      ? <button className="button buttonSecondary voteCooldownButton" type="button" disabled aria-describedby="proposal-vote-cooldown"><Clock3 size={14} aria-hidden="true" /><span role="timer" aria-label={`Voting opens at ${proposalVotingStartsAt.toISOString()}`}>Vote in {countdown}</span></button>
      : !eligibility.eligible
      ? <EligibilityAction eligibility={eligibility} action="vote" callbackUrl={`/vote?focus=${proposal.slug}`}>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction>
      : <Link className="button buttonPrimary" href={`/vote?focus=${proposal.slug}`}>{allocatedVotes > 0 ? "Cast more votes" : "Cast a vote"}</Link>}
    {!proposalVotingOpen && availability.votingOpen && <span className="srOnly" id="proposal-vote-cooldown">Voting unlocks 30 minutes after this OTF was confirmed.</span>}
  </div></SectionCard>;
}
