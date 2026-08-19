"use client";

import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { CalendarClock, CheckCircle2, CircleAlert, ExternalLink, LockKeyhole, Minus, Plus, Send, ShieldAlert, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getCommittedBallotState } from "@/lib/ballot-state";
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
  const initialCommittedState = useMemo(() => getCommittedBallotState(
    proposals.map((proposal) => proposal.id),
    ballot,
  ), [ballot, proposals]);
  const initialAdditions = useMemo(() => {
    const values = Object.fromEntries(proposals.map((proposal) => [proposal.id, 0])) as Record<string, number>;
    if (ballot?.status !== "valid" && focusSlug && availability.unlockedVotes > 0) {
      const focused = proposals.find((proposal) => proposal.slug === focusSlug);
      if (focused) values[focused.id] = 1;
    }
    return values;
  }, [availability.unlockedVotes, ballot?.status, focusSlug, proposals]);
  const [additions, setAdditions] = useState<Record<string, number>>(initialAdditions);
  const [committedVotes, setCommittedVotes] = useState<Record<string, number>>(initialCommittedState.committedVotes);
  const [castTotal, setCastTotal] = useState(initialCommittedState.castTotal);
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [revealVotes, setRevealVotes] = useState(false);
  const voteAdditions = proposals
    .map((proposal) => ({ proposalId: proposal.id, votes: additions[proposal.id] ?? 0 }))
    .filter(({ votes }) => votes > 0);
  const newVotes = voteAdditions.reduce((sum, addition) => sum + addition.votes, 0);
  const total = castTotal + newVotes;
  const unlockedRemaining = Math.max(0, availability.unlockedVotes - castTotal);
  const addedChoices = voteAdditions.map((addition) => ({
    ticker: proposals.find((proposal) => proposal.id === addition.proposalId)?.ticker ?? "OTF",
    votes: addition.votes,
  }));
  const previewText = buildVotePost(reason, siteUrl, "[verification code]", revealVotes ? addedChoices : []);
  const disclosurePreviewLabel = revealVotes
    ? addedChoices.length > 0 ? "batch picks included" : "picks appear after selection"
    : "picks not shown";

  function adjustVote(proposalId: string, delta: number) {
    setMessage(null);
    setAdditions((current) => {
      const currentValue = current[proposalId] ?? 0;
      const nextValue = Math.max(0, Math.min(COMPETITION_RULES.totalVotes, currentValue + delta));
      const nextTotal = castTotal + sumVotes(current) - currentValue + nextValue;
      if (nextTotal > availability.unlockedVotes) return current;
      return { ...current, [proposalId]: nextValue };
    });
  }

  async function request(action: "prepare" | "verify") {
    const postWindow = action === "prepare" ? window.open("about:blank", "_blank") : null;
    setBusy(true);
    setMessage(null);
    const body = action === "prepare"
      ? { action, reason, additions: voteAdditions, revealVotes, turnstileToken }
      : { action, challengeId: challenge?.challengeId, postUrl };
    try {
      const response = await fetch("/api/v1/ballot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        postWindow?.close();
        if (action === "prepare") setTurnstileResetKey((current) => current + 1);
        const rawCode = typeof json?.error?.code === "string" ? json.error.code : undefined;
        const code = rawCode && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : undefined;
        if (action === "verify" && (code === "PROPOSAL_POST_NOT_FOUND" || code === "PROPOSAL_NOT_FOUND")) {
          router.replace(`/?voteError=${code}`);
          return;
        }
        setMessageTone("error");
        setMessage(code ? errorMessages[code] ?? `Voting failed (${code}). Please try again.` : "The voting service did not return a valid response. Please try again.");
        return;
      }
      if (action === "prepare") {
        setChallenge(json.data);
        if (postWindow) {
          postWindow.opener = null;
          postWindow.location.replace(json.data.intentUrl);
        }
      }
      if (action === "verify") {
        setCommittedVotes((current) => Object.fromEntries(Object.entries(current).map(([proposalId, votes]) => [
          proposalId,
          votes + (additions[proposalId] ?? 0),
        ])));
        setCastTotal(total);
        setAdditions(Object.fromEntries(proposals.map((proposal) => [proposal.id, 0])));
        setChallenge(null);
        setPostUrl("");
        setReason("");
        setRevealVotes(false);
        setTurnstileToken("");
        setTurnstileResetKey((current) => current + 1);
        setMessageTone("success");
        setMessage(`${newVotes} ${newVotes === 1 ? "vote is" : "votes are"} now cast. Cast votes are final.`);
        router.refresh();
      }
    } catch {
      postWindow?.close();
      setMessageTone("error");
      setMessage("The voting service could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    setChallenge(null);
    setPostUrl("");
    setTurnstileToken("");
    setTurnstileResetKey((current) => current + 1);
    setMessage(null);
  }

  if (!availability.votingOpen) return <SectionCard className="emptyState phaseBlocked"><CalendarClock size={28} /><h2>Voting opens on competition day 8</h2><p>Three votes unlock at {formatDateTime(availability.votingStartsAt)}. Until then, the first week is reserved for OTF submissions.</p><Button href="/submit">Create an OTF</Button></SectionCard>;
  if (!proposals.length) return <SectionCard className="emptyState ballotEmptyState"><Vote size={28} /><h2>No OTF proposals available</h2><p>Your unlocked votes remain available until proposals join the competition.</p><Button href="/submit">Create the first OTF</Button></SectionCard>;
  if (!eligibility.eligible) return <SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers to cast up to {COMPETITION_RULES.totalVotes} votes.</p><EligibilityAction eligibility={eligibility} action="vote" callbackUrl="/vote" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction></SectionCard>;

  const actionPanel = <SectionCard className="ballotAction ballotActionWide">
    <div className="ballotActionIntro"><strong>Publish your voting post</strong><p>{challenge ? `Publish the prepared X post, then paste its URL below to cast ${newVotes} ${newVotes === 1 ? "vote" : "votes"}.` : newVotes > 0 ? `${newVotes} new ${newVotes === 1 ? "vote is" : "votes are"} ready. One X post can verify this whole batch.` : unlockedRemaining > 0 ? "Use the + controls to choose one or more votes. Every voting action requires a new X post." : availability.nextVoteUnlockAt ? "You have cast every vote currently unlocked." : "You have cast all 12 votes."}</p></div>
    {message ? <div className={`ballotActionResult ${messageTone}`} role="status">{messageTone === "success" ? <CheckCircle2 size={24} /> : <CircleAlert size={24} />}<div><strong>{messageTone === "success" ? "Votes cast" : "Couldn't cast your votes"}</strong><p>{message}</p></div>{messageTone === "success" && unlockedRemaining > 0 && <div className="ballotActionResultActions"><Button onClick={() => setMessage(null)}>Cast more votes</Button></div>}{messageTone === "error" && <div className="ballotActionResultActions"><Button onClick={challenge ? startAgain : () => setMessage(null)}>Try again</Button></div>}</div> : <><div className="ballotActionFields"><label className="formField"><span>Why are you voting? <small>(optional)</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Share why you’re helping choose the next OTFs…" rows={3} maxLength={120} disabled={busy || Boolean(challenge)} /><small>{reason.length} / 120 characters</small></label><label className="privacyChoice"><input type="checkbox" checked={revealVotes} disabled={busy || Boolean(challenge)} onChange={(event) => setRevealVotes(event.target.checked)} /><span><strong>Reveal my picks in this post</strong><small>{revealVotes ? addedChoices.length > 0 ? "The post will name the OTFs and vote counts in this batch." : "Your selected OTFs will appear after you add votes." : "Off by default. The OTFs receiving these votes will stay private."}</small></span></label></div>
    <div className="ballotActionPublish"><div className="xPostPreview compact"><div><span>{challenge ? "Ready to publish" : `Post preview · ${disclosurePreviewLabel}`}</span><Send size={13} /></div><p>{challenge?.postText ?? previewText}</p></div>{challenge ? <div className="postAction"><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><p className="postAssurance">We never post anything on your behalf.</p></div> : <><Turnstile siteKey={turnstileSiteKey} action="vote_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} />{(!turnstileSiteKey || turnstileToken) && <div className="postAction"><Button onClick={() => request("prepare")} disabled={busy || newVotes < 1}>{busy ? "Preparing…" : <>Open X and post <ExternalLink size={14} /></>}</Button><p className="postAssurance">We never post anything on your behalf.</p></div>}</>}<label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" disabled={busy || !challenge} /><small>{challenge ? "Paste the URL of the public post containing the verification code." : "Post to X first; this field will be ready after the post is prepared."}</small></label><Button onClick={() => request("verify")} disabled={busy || !challenge || !postUrl.trim()}>{busy ? "Verifying…" : `Verify and cast ${newVotes} ${newVotes === 1 ? "vote" : "votes"}`}</Button></div></>}
  </SectionCard>;

  return <div className="ballotLayout"><SectionCard className="ballotCard"><div className="ballotToolbar"><div><span>Your vote ledger</span><small>Cast votes are permanent. Add newly unlocked votes at any time.</small></div><div className={`ballotTotal${newVotes > 0 ? " valid" : ""}`} aria-label={`${total} of ${availability.unlockedVotes} votes selected`}><strong>{total} / {availability.unlockedVotes}</strong></div></div>
    <div className="ballotRows">{proposals.map((proposal) => {
      const committed = committedVotes[proposal.id] ?? 0;
      const addition = additions[proposal.id] ?? 0;
      const value = committed + addition;
      const controlsLocked = busy || Boolean(challenge);
      return <div className="ballotRow" key={proposal.id}>
        <OtfTokenIcon ticker={proposal.ticker} size={38} />
        <div className="ballotIdentity"><strong>{proposal.name}</strong><span>${proposal.ticker} · {proposal.votes.toLocaleString()} votes</span>{committed > 0 && <small><LockKeyhole size={11} /> {committed} locked {committed === 1 ? "vote" : "votes"}</small>}</div>
        <div className="voteStepper" role="group" aria-label={`Votes for ${proposal.name}`}>
          <button type="button" onClick={() => adjustVote(proposal.id, -1)} disabled={controlsLocked || addition === 0} aria-label={`Remove uncast vote from ${proposal.name}`}><Minus size={15} /></button>
          <strong aria-live="polite">{value}</strong>
          <button type="button" onClick={() => adjustVote(proposal.id, 1)} disabled={controlsLocked || total >= availability.unlockedVotes} aria-label={`Add vote to ${proposal.name}`}><Plus size={15} /></button>
        </div>
      </div>;
    })}</div>
  </SectionCard><aside className="ballotRail"><SectionCard className="ballotSummary"><div className="ballotSummaryStatus"><div className="ballotSummaryCount"><span>Remaining votes</span><strong className={unlockedRemaining === 0 ? "complete" : ""}>{unlockedRemaining}</strong></div><p>{availability.nextVoteUnlockAt ? `Next vote unlocks ${formatDateTime(availability.nextVoteUnlockAt)}.` : `All ${COMPETITION_RULES.totalVotes} votes are unlocked. No vote is added on voting day 30.`}</p></div><div className="voteUnlockTrack" role="progressbar" aria-label="Votes unlocked" aria-valuemin={0} aria-valuemax={COMPETITION_RULES.totalVotes} aria-valuenow={availability.unlockedVotes}><span style={{ width: `${availability.unlockedVotes / COMPETITION_RULES.totalVotes * 100}%` }} /></div><small>{availability.unlockedVotes} of {COMPETITION_RULES.totalVotes} unlocked</small></SectionCard></aside>
    <div className="ballotActionArea">{actionPanel}</div>
  </div>;
}
