"use client";

import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { ArrowDown, CalendarClock, ExternalLink, LockKeyhole, Minus, Plus, Send, ShieldAlert, Vote, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMPETITION_RULES } from "@/lib/competition";
import { errorMessages } from "@/lib/errors";
import type { BallotSummary, LeaderboardEntry, ParticipationEligibility } from "@/lib/types";
import { buildVotePost } from "@/lib/x-post";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";
import { Button, SectionCard } from "./ui";

type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };
type VoteAvailability = {
  votingOpen: boolean;
  unlockedVotes: number;
  votingStartsAt: string;
  nextVoteUnlockAt: string | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function sumVotes(votes: Record<string, number>) {
  return Object.values(votes).reduce((sum, value) => sum + value, 0);
}

function VotePostDialog({ challenge, open, postUrl, busy, newVotes, onPostUrlChange, onVerify, onClose, onStartOver }: {
  challenge: Challenge;
  open: boolean;
  postUrl: string;
  busy: boolean;
  newVotes: number;
  onPostUrlChange(value: string): void;
  onVerify(): void;
  onClose(): void;
  onStartOver(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={dialogRef} className="votePostDialog" onClose={onClose} onCancel={onClose} aria-labelledby="vote-post-dialog-title">
    <div className="votePostDialogBody">
      <button className="dialogClose" type="button" onClick={onClose} aria-label="Close voting post steps"><X size={17} /></button>
      <div className="votePostStepHeading"><span>1</span><div><h2 id="vote-post-dialog-title">Post to X</h2><p>Open X and publish the prepared post.</p></div></div>
      <div className="xPostPreview compact"><div><span>Ready to publish</span><Send size={13} /></div><p>{challenge.postText}</p></div>
      <div className="postAction"><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><p className="postAssurance">We never post anything on your behalf.</p></div>
      <div className="votePostFlowArrow" aria-hidden="true"><ArrowDown size={18} /></div>
      <div className="votePostStepHeading"><span>2</span><div><h3>Verify your post</h3><p>Paste the URL of your published X post to cast your votes.</p></div></div>
      <label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => onPostUrlChange(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /></label>
      <Button onClick={onVerify} disabled={busy || !postUrl.trim()}>{busy ? "Verifying…" : `Verify and cast ${newVotes} ${newVotes === 1 ? "vote" : "votes"}`}</Button>
      <Button variant="ghost" onClick={onStartOver}>Start again</Button>
    </div>
  </dialog>;
}

export function BallotPanel({ proposals, ballot, eligibility, availability, focusSlug, turnstileSiteKey, siteUrl }: {
  proposals: LeaderboardEntry[];
  ballot: BallotSummary | null;
  eligibility: ParticipationEligibility;
  availability: VoteAvailability;
  focusSlug?: string;
  turnstileSiteKey?: string;
  siteUrl: string;
}) {
  const router = useRouter();
  const initialCommitted = useMemo(() => {
    const values = Object.fromEntries(proposals.map((proposal) => [proposal.id, 0])) as Record<string, number>;
    if (ballot?.status === "valid") {
      for (const allocation of ballot.allocations) {
        if (allocation.proposalId in values) values[allocation.proposalId] = allocation.votes;
      }
    }
    return values;
  }, [ballot, proposals]);
  const initialVotes = useMemo(() => {
    const values = { ...initialCommitted };
    if (ballot?.status !== "valid" && focusSlug && availability.unlockedVotes > 0) {
      const focused = proposals.find((proposal) => proposal.slug === focusSlug);
      if (focused) values[focused.id] = 1;
    }
    return values;
  }, [availability.unlockedVotes, ballot?.status, focusSlug, initialCommitted, proposals]);
  const [votes, setVotes] = useState<Record<string, number>>(initialVotes);
  const [committedVotes, setCommittedVotes] = useState<Record<string, number>>(initialCommitted);
  const [active, setActive] = useState(ballot?.status === "valid");
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [revealVotes, setRevealVotes] = useState(false);
  const total = sumVotes(votes);
  const castTotal = sumVotes(committedVotes);
  const newVotes = total - castTotal;
  const unlockedRemaining = Math.max(0, availability.unlockedVotes - total);
  const allocations = Object.entries(votes).map(([proposalId, value]) => ({ proposalId, votes: value })).filter(({ votes: value }) => value > 0);
  const addedChoices = allocations.map((allocation) => ({
    ticker: proposals.find((proposal) => proposal.id === allocation.proposalId)?.ticker ?? "OTF",
    votes: allocation.votes - (committedVotes[allocation.proposalId] ?? 0),
  })).filter((choice) => choice.votes > 0);
  const previewText = buildVotePost(reason, siteUrl, "[verification code]", revealVotes ? addedChoices : []);
  const disclosurePreviewLabel = revealVotes
    ? addedChoices.length > 0 ? "batch picks included" : "picks appear after selection"
    : "picks not shown";

  function adjustVote(proposalId: string, delta: number) {
    setMessage(null);
    setVotes((current) => {
      const currentValue = current[proposalId] ?? 0;
      const floor = committedVotes[proposalId] ?? 0;
      const nextValue = Math.max(floor, Math.min(COMPETITION_RULES.totalVotes, currentValue + delta));
      const nextTotal = sumVotes(current) - currentValue + nextValue;
      if (nextTotal > availability.unlockedVotes) return current;
      return { ...current, [proposalId]: nextValue };
    });
  }

  async function request(action: "prepare" | "verify") {
    setBusy(true);
    setMessage(null);
    const body = action === "prepare"
      ? { action, reason, allocations, revealVotes, turnstileToken }
      : { action, challengeId: challenge?.challengeId, postUrl };
    const response = await fetch("/api/v1/ballot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      if (action === "prepare") setTurnstileResetKey((current) => current + 1);
      if (action === "verify") setPostDialogOpen(false);
      const code = typeof json.error?.code === "string" ? json.error.code : undefined;
      setMessageTone("error");
      setMessage(code ? errorMessages[code] ?? "Your votes could not be cast. Please try again." : "Your votes could not be cast.");
      return;
    }
    if (action === "prepare") {
      setChallenge(json.data);
      setPostDialogOpen(true);
    }
    if (action === "verify") {
      setActive(true);
      setCommittedVotes({ ...votes });
      setChallenge(null);
      setPostDialogOpen(false);
      setPostUrl("");
      setReason("");
      setRevealVotes(false);
      setTurnstileToken("");
      setTurnstileResetKey((current) => current + 1);
      setMessageTone("success");
      setMessage(`${newVotes} ${newVotes === 1 ? "vote is" : "votes are"} now cast. Cast votes are final.`);
      router.refresh();
    }
  }

  function startAgain() {
    setChallenge(null);
    setPostDialogOpen(false);
    setPostUrl("");
    setMessage(null);
  }

  if (!availability.votingOpen) return <SectionCard className="emptyState phaseBlocked"><CalendarClock size={28} /><h2>Voting opens on competition day 8</h2><p>Three votes unlock at {formatDateTime(availability.votingStartsAt)}. Until then, the first week is reserved for OTF submissions.</p><Button href="/submit">Submit an OTF</Button></SectionCard>;
  if (!proposals.length) return <SectionCard className="emptyState"><Vote size={28} /><h2>No OTF proposals available</h2><p>Your unlocked votes remain available until proposals join the competition.</p><Button href="/submit">Submit the first OTF</Button></SectionCard>;
  if (!eligibility.eligible) return <SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers to cast up to {COMPETITION_RULES.totalVotes} votes.</p><EligibilityAction eligibility={eligibility} action="vote" callbackUrl="/vote" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction></SectionCard>;

  const actionPanel = <SectionCard className="ballotAction ballotActionWide">
    <div className="ballotActionIntro"><strong>{active ? "Post and cast new votes" : "Post and cast your first votes"}</strong><p>{newVotes > 0 ? `${newVotes} new ${newVotes === 1 ? "vote is" : "votes are"} ready. One X post can verify this whole batch.` : unlockedRemaining > 0 ? "Use the + controls to choose one or more votes. Every voting action requires a new X post." : availability.nextVoteUnlockAt ? "You have cast every vote currently unlocked." : "You have cast all 12 votes."}</p>{ballot?.proofUrl && <a className="inlineLink" href={ballot.proofUrl} target="_blank" rel="noreferrer">View first vote post <ExternalLink size={13} /></a>}{message && <div className={`ballotInlineMessage ${messageTone}`} role="status">{message}</div>}</div>
    {!challenge ? <><div className="ballotActionFields"><label className="formField"><span>Why are you voting? <small>(optional)</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Share why you’re helping choose the next OTFs…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters</small></label><label className="privacyChoice"><input type="checkbox" checked={revealVotes} onChange={(event) => setRevealVotes(event.target.checked)} /><span><strong>Reveal my picks in this post</strong><small>{revealVotes ? addedChoices.length > 0 ? "The post will name the OTFs and vote counts in this batch." : "Your selected OTFs will appear after you add votes." : "Off by default. The OTFs receiving these votes will stay private."}</small></span></label></div>
    <div className="ballotActionPublish"><div className="xPostPreview compact"><div><span>Post preview · {disclosurePreviewLabel}</span><Send size={13} /></div><p>{previewText}</p></div><Turnstile siteKey={turnstileSiteKey} action="vote_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} />{(!turnstileSiteKey || turnstileToken) && <div className="postAction"><Button onClick={() => request("prepare")} disabled={busy || newVotes < 1}>{busy ? "Preparing…" : "Post to X"}</Button><p className="postAssurance">We never post anything on your behalf.</p></div>}</div></> : <div className="ballotPendingAction"><div><strong>Your voting post is ready</strong><p>Continue to publish it on X, then verify the post to cast your votes.</p></div><Button onClick={() => setPostDialogOpen(true)}>Continue verification</Button><Button variant="ghost" onClick={startAgain}>Start again</Button></div>}
  </SectionCard>;

  return <div className="ballotLayout"><SectionCard className="ballotCard"><div className="ballotToolbar"><div><span>Your vote ledger</span><small>Cast votes are permanent. Add newly unlocked votes at any time.</small></div><div className={`ballotTotal${newVotes > 0 ? " valid" : ""}`} aria-label={`${total} of ${availability.unlockedVotes} votes selected`}><strong>{total} / {availability.unlockedVotes}</strong></div></div>
    <div className="ballotRows">{proposals.map((proposal) => {
      const value = votes[proposal.id] ?? 0;
      const committed = committedVotes[proposal.id] ?? 0;
      const controlsLocked = busy || Boolean(challenge);
      return <div className="ballotRow" key={proposal.id}>
        <OtfTokenIcon ticker={proposal.ticker} size={38} />
        <div className="ballotIdentity"><strong>{proposal.name}</strong><span>${proposal.ticker} · {proposal.votes.toLocaleString()} community votes</span>{committed > 0 && <small><LockKeyhole size={11} /> {committed} cast here</small>}</div>
        <div className="voteStepper" role="group" aria-label={`Votes for ${proposal.name}`}>
          <button type="button" onClick={() => adjustVote(proposal.id, -1)} disabled={controlsLocked || value <= committed} aria-label={`Remove uncast vote from ${proposal.name}`}><Minus size={15} /></button>
          <strong aria-live="polite">{value}</strong>
          <button type="button" onClick={() => adjustVote(proposal.id, 1)} disabled={controlsLocked || total >= availability.unlockedVotes} aria-label={`Add vote to ${proposal.name}`}><Plus size={15} /></button>
        </div>
      </div>;
    })}</div>
  </SectionCard><aside className="ballotRail"><SectionCard className="ballotSummary"><div className="ballotSummaryStatus"><div className="ballotSummaryCount"><span>Remaining votes</span><strong className={unlockedRemaining === 0 ? "complete" : ""}>{unlockedRemaining}</strong></div><p>{availability.nextVoteUnlockAt ? `Next vote unlocks ${formatDateTime(availability.nextVoteUnlockAt)}.` : `All ${COMPETITION_RULES.totalVotes} votes are unlocked. No vote is added on voting day 30.`}</p></div><div className="voteUnlockTrack" role="progressbar" aria-label="Votes unlocked" aria-valuemin={0} aria-valuemax={COMPETITION_RULES.totalVotes} aria-valuenow={availability.unlockedVotes}><span style={{ width: `${availability.unlockedVotes / COMPETITION_RULES.totalVotes * 100}%` }} /></div><small>{availability.unlockedVotes} of {COMPETITION_RULES.totalVotes} unlocked</small></SectionCard></aside>
    <div className="ballotActionArea">{actionPanel}</div>
    {challenge && <VotePostDialog challenge={challenge} open={postDialogOpen} postUrl={postUrl} busy={busy} newVotes={newVotes} onPostUrlChange={setPostUrl} onVerify={() => request("verify")} onClose={() => setPostDialogOpen(false)} onStartOver={startAgain} />}
  </div>;
}
