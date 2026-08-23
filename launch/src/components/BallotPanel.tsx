"use client";

import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { CalendarClock, CheckCircle2, CircleAlert, ExternalLink, LockKeyhole, Minus, Plus, Search, Send, ShieldAlert, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { getCommittedBallotState } from "@/lib/ballot-state";
import { requestWithChallengeReconciliation } from "@/lib/challenge-reconciliation";
import type { CompetitionRules } from "@/lib/competition";
import { errorMessages } from "@/lib/errors";
import type { BallotSummary, LeaderboardEntry, LeaderboardPage, ParticipationEligibility } from "@/lib/types";
import { buildVotePost } from "@/lib/x-post";
import { CompetitionCountdown } from "./CompetitionCountdown";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";
import { Button, Callout, SectionCard, StatusBadge } from "./ui";

type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };
type VoteAvailability = {
  votingOpen: boolean;
  competitionEnded: boolean;
  unlockedVotes: number;
  votingStartsAt: string;
  nextVoteUnlockAt: string | null;
};

const PAGE_SIZE = 50;

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

export function BallotPanel({ initialPage, totalProposalCount, ballot, eligibility, rules, availability, focusSlug, turnstileSiteKey, currentTime }: {
  initialPage: LeaderboardPage;
  totalProposalCount: number;
  ballot: BallotSummary | null;
  eligibility: ParticipationEligibility;
  rules: CompetitionRules;
  availability: VoteAvailability;
  focusSlug?: string;
  turnstileSiteKey?: string;
  currentTime: string;
}) {
  const router = useRouter();
  const initialProposals = initialPage.entries;
  const [proposals, setProposals] = useState(initialProposals);
  const [knownProposals, setKnownProposals] = useState<Record<string, LeaderboardEntry>>(
    Object.fromEntries(initialProposals.map((proposal) => [proposal.id, proposal])),
  );
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const initialCommittedState = useMemo(() => getCommittedBallotState(
    [...new Set([...initialProposals.map((proposal) => proposal.id), ...(ballot?.allocations.map((allocation) => allocation.proposalId) ?? [])])],
    ballot,
  ), [ballot, initialProposals]);
  const initialAdditions = useMemo(() => {
    const values = Object.fromEntries(initialProposals.map((proposal) => [proposal.id, 0])) as Record<string, number>;
    if (ballot?.status !== "valid" && focusSlug && availability.unlockedVotes > 0) {
      const focused = initialProposals.find((proposal) => proposal.slug === focusSlug);
      if (focused) values[focused.id] = 1;
    }
    return values;
  }, [availability.unlockedVotes, ballot?.status, focusSlug, initialProposals]);
  const [additions, setAdditions] = useState<Record<string, number>>(initialAdditions);
  const [committedVotes, setCommittedVotes] = useState<Record<string, number>>(initialCommittedState.committedVotes);
  const [castTotal, setCastTotal] = useState(initialCommittedState.castTotal);
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");
  const [messageAction, setMessageAction] = useState<"dismiss" | "restart" | "retry" | "profile">("dismiss");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [revealVotes, setRevealVotes] = useState(false);
  const voteAdditions = Object.entries(additions)
    .filter(([, votes]) => votes > 0)
    .map(([proposalId, votes]) => ({ proposalId, votes }));
  const newVotes = voteAdditions.reduce((sum, addition) => sum + addition.votes, 0);
  const total = castTotal + newVotes;
  const unlockedRemaining = Math.max(0, availability.unlockedVotes - castTotal);
  const addedChoices = voteAdditions.map((addition) => ({
    ticker: knownProposals[addition.proposalId]?.ticker ?? "OTF",
    votes: addition.votes,
  }));
  const previewText = buildVotePost(reason, "[verification code]", revealVotes ? addedChoices : []);
  const disclosurePreviewLabel = revealVotes
    ? addedChoices.length > 0 ? "batch picks included" : "picks appear after selection"
    : "picks not shown";

  function adjustVote(proposalId: string, delta: number) {
    setMessage(null);
    setAdditions((current) => {
      const currentValue = current[proposalId] ?? 0;
      const nextValue = Math.max(0, Math.min(rules.totalVotes, currentValue + delta));
      const nextTotal = castTotal + sumVotes(current) - currentValue + nextValue;
      if (nextTotal > availability.unlockedVotes) return current;
      return { ...current, [proposalId]: nextValue };
    });
  }

  function mergeKnown(next: LeaderboardEntry[]) {
    setKnownProposals((current) => ({ ...current, ...Object.fromEntries(next.map((proposal) => [proposal.id, proposal])) }));
  }

  async function fetchProposalPage(search: string, cursor: string | null) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (search) params.set("q", search);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/v1/leaderboard?${params.toString()}`);
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.data) throw new Error("PROPOSAL_LIST_LOAD_FAILED");
    return json.data as LeaderboardPage;
  }

  async function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = query.trim();
    setListLoading(true);
    setListError(null);
    try {
      const page = await fetchProposalPage(search, null);
      mergeKnown(page.entries);
      setProposals(page.entries);
      setNextCursor(page.nextCursor);
      setAppliedQuery(search);
    } catch {
      setListError("Search could not be loaded. Your vote selections are unchanged.");
    } finally {
      setListLoading(false);
    }
  }

  async function clearSearch() {
    setQuery("");
    setListLoading(true);
    setListError(null);
    try {
      const page = await fetchProposalPage("", null);
      mergeKnown(page.entries);
      setProposals(page.entries);
      setNextCursor(page.nextCursor);
      setAppliedQuery("");
    } catch {
      setListError("The proposal list could not be reloaded. Your vote selections are unchanged.");
    } finally {
      setListLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setListLoading(true);
    setListError(null);
    try {
      const page = await fetchProposalPage(appliedQuery, nextCursor);
      mergeKnown(page.entries);
      setProposals((current) => {
        const seen = new Set(current.map((proposal) => proposal.id));
        return [...current, ...page.entries.filter((proposal) => !seen.has(proposal.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      setListError("More proposals could not be loaded. Your vote selections are unchanged.");
    } finally {
      setListLoading(false);
    }
  }

  function completeVerifiedBallot() {
    setCommittedVotes((current) => {
      const next = { ...current };
      for (const addition of voteAdditions) {
        next[addition.proposalId] = (next[addition.proposalId] ?? 0) + addition.votes;
      }
      return next;
    });
    setCastTotal(total);
    setAdditions((current) => Object.fromEntries(Object.keys(current).map((proposalId) => [proposalId, 0])));
    setChallenge(null);
    setPostUrl("");
    setReason("");
    setRevealVotes(false);
    setTurnstileToken("");
    setTurnstileResetKey((current) => current + 1);
    setMessageTone("success");
    setMessageAction("dismiss");
    setMessage(`${newVotes} ${newVotes === 1 ? "vote is" : "votes are"} now cast. Keep the X post public and unchanged until final results are published. If it becomes invalid, this batch is void and its spent votes are not restored.`);
    router.refresh();
  }

  async function request(action: "prepare" | "verify") {
    const postWindow = action === "prepare" ? window.open("about:blank", "_blank") : null;
    if (postWindow) postWindow.opener = null;
    setBusy(true);
    setMessage(null);
    setMessageAction("dismiss");
    const body = action === "prepare"
      ? { action, reason, additions: voteAdditions, revealVotes, turnstileToken }
      : { action, challengeId: challenge?.challengeId, postUrl };
    try {
      const ballotRequest = () => fetch("/api/v1/ballot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const outcome = action === "verify" && challenge
        ? await requestWithChallengeReconciliation(
          ballotRequest,
          challenge.challengeId,
          fetch,
          (data) => typeof data === "object" && data !== null && typeof (data as { ballotId?: unknown }).ballotId === "string",
        )
        : null;
      if (outcome?.kind === "status") {
        if (outcome.status.status === "succeeded") {
          if (outcome.status.action === "vote") {
            completeVerifiedBallot();
            return;
          }
          setMessageTone("error");
          setMessageAction("profile");
          setMessage("We couldn’t match the completed verification to this ballot. Don’t verify or post again; check My profile for the saved result.");
          return;
        }
        setMessageTone("error");
        if (outcome.status.status === "ready") {
          setMessageAction("retry");
          setMessage("The response was interrupted before confirmation, but this verification is still ready. It is safe to verify the same X post again.");
          return;
        }
        if (outcome.status.status === "expired") {
          setChallenge(null);
          setPostUrl("");
          setTurnstileToken("");
          setTurnstileResetKey((current) => current + 1);
          setMessageAction("dismiss");
          setMessage("The response was interrupted and the verification code has expired. Prepare and publish a new voting post for this batch.");
          return;
        }
        setMessageTone("error");
        setMessageAction("profile");
        setMessage("We couldn’t confirm this ballot’s verification state. Don’t verify or post again yet; check My profile for the voting batch.");
        return;
      }
      if (outcome?.kind === "unknown") {
        setMessageTone("error");
        setMessageAction("profile");
        setMessage("We couldn’t confirm whether these votes were cast. Don’t verify or post them again yet; check My profile for the voting batch.");
        return;
      }
      const response = outcome?.kind === "response" ? outcome.response : await ballotRequest();
      const json = outcome?.kind === "response" ? outcome.body : await response.json().catch(() => null);
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
        setMessageAction(action === "verify" && challenge ? "restart" : "dismiss");
        setMessage(code ? errorMessages[code] ?? `Voting failed (${code}). Please try again.` : "The voting service did not return a valid response. Please try again.");
        return;
      }
      if (action === "prepare") {
        setChallenge(json.data);
        if (postWindow) {
          postWindow.location.replace(json.data.intentUrl);
        }
      }
      if (action === "verify") {
        completeVerifiedBallot();
      }
    } catch {
      postWindow?.close();
      setMessageTone("error");
      setMessageAction("dismiss");
      setMessage(action === "prepare"
        ? "The voting post could not be prepared. Check your connection and try again."
        : "We couldn’t confirm whether these votes were cast. Don’t verify or post them again yet; check My profile for the voting batch.");
      if (action === "verify") setMessageAction("profile");
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

  if (availability.competitionEnded) {
    const votePosts = ballot?.votePosts ?? [];
    const trancheByProposal = new Map(votePosts.flatMap((post) => post.tranches).map((tranche) => [tranche.proposalId, tranche]));
    const closedAllocations = (ballot?.allocations ?? []).map((allocation) => ({
      ...allocation,
      proposal: proposals.find((proposal) => proposal.id === allocation.proposalId),
      tranche: trancheByProposal.get(allocation.proposalId),
    }));
    return <div className="ballotLayout closedBallotLayout"><SectionCard className="ballotCard"><div className="ballotToolbar"><div><span>Your vote ledger</span><small>Voting is closed. Cast votes remain permanent and auditable.</small></div><div className="ballotTotal valid" aria-label={`${castTotal} votes cast`}><strong>{castTotal} cast</strong></div></div>{closedAllocations.length ? <div className="ballotRows">{closedAllocations.map(({ proposal, tranche, proposalId, votes }) => <div className="ballotRow" key={proposalId}><OtfTokenIcon ticker={proposal?.ticker ?? tranche?.proposalTicker ?? "OTF"} size={38} /><div className="ballotIdentity"><strong>{proposal?.name ?? tranche?.proposalName ?? "Unavailable OTF"}</strong><span>${proposal?.ticker ?? tranche?.proposalTicker ?? "OTF"}{tranche?.proposalStatus === "deleted" ? " · unavailable" : ""}</span><small><LockKeyhole size={11} /> {votes} locked {votes === 1 ? "vote" : "votes"}</small></div><strong className="closedVoteCount">{votes}</strong></div>)}</div> : <div className="emptyState phaseBlocked"><LockKeyhole size={28} /><h2>No votes cast</h2><p>The competition ended without votes from this account.</p></div>}</SectionCard><aside className="ballotRail"><SectionCard className="ballotSummary"><div className="ballotSummaryStatus"><div className="ballotSummaryCount"><span>Voting status</span><strong className="complete">Closed</strong></div><p>The final review uses the locked vote and X post records shown here.</p></div></SectionCard></aside><div className="ballotActionArea"><SectionCard className="contentCard accountVoteHistory"><div className="accountSectionHeading"><div><h2>Voting post history</h2><p>Each verified post records one immutable voting batch.</p></div></div>{votePosts.length ? <ol className="votePostList">{votePosts.map((post, index) => { const label = `Vote post ${index + 1}`; const statusTone = post.status === "valid" ? "positive" : post.status === "invalid" ? "danger" : "warning"; return <li className="votePostRow" key={post.evidenceId}><div className="votePostHeader"><div className="votePostIdentity"><a className="votePostLink" href={post.postUrl} target="_blank" rel="noreferrer">{label}<ExternalLink size={13} aria-hidden="true" /></a><StatusBadge tone={statusTone}>{post.status}</StatusBadge></div><time dateTime={post.acceptedAt}>{new Date(post.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div><ul className="voteTrancheList" aria-label={`Votes verified by ${label}`}>{post.tranches.map((tranche) => <li className="voteTrancheRow" key={tranche.id}><div><strong>{tranche.proposalName}</strong><small>${tranche.proposalTicker}{tranche.proposalStatus === "deleted" ? " · unavailable" : ""}</small></div><strong>{tranche.votes} {tranche.votes === 1 ? "vote" : "votes"}</strong></li>)}</ul></li>; })}</ol> : <p>No voting posts were verified for this account.</p>}</SectionCard></div></div>;
  }
  if (!availability.votingOpen) return <SectionCard className="emptyState phaseBlocked"><CalendarClock size={28} /><h2>Voting opens in</h2><CompetitionCountdown target={availability.votingStartsAt} currentTime={currentTime} /><p>Three votes unlock at {formatDateTime(availability.votingStartsAt)}. Until then, the first week is reserved for OTF submissions.</p><Button href="/submit">Create an OTF</Button></SectionCard>;
  if (totalProposalCount === 0) return <SectionCard className="emptyState ballotEmptyState"><Vote size={28} /><h2>No OTF proposals available</h2><p>Your unlocked votes remain available until proposals join the competition.</p><Button href="/submit">Create the first OTF</Button></SectionCard>;
  if (!eligibility.eligible) return <SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers to cast up to {rules.totalVotes} votes.</p><EligibilityAction eligibility={eligibility} action="vote" callbackUrl="/vote" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in to vote"}</EligibilityAction></SectionCard>;

  const actionPanel = <SectionCard className="ballotAction ballotActionWide">
    <div className="ballotActionIntro"><strong>Publish your voting post</strong><p>{challenge ? `Publish the prepared X post, then paste its URL below to cast ${newVotes} ${newVotes === 1 ? "vote" : "votes"}.` : newVotes > 0 ? `${newVotes} new ${newVotes === 1 ? "vote is" : "votes are"} ready. One X post can verify this whole batch.` : unlockedRemaining > 0 ? "Use the + controls to choose one or more votes. Every voting action requires a new X post." : availability.nextVoteUnlockAt ? "You have cast every vote currently unlocked." : "You have cast all 12 votes."}</p></div>
    {message ? <div className={`ballotActionResult ${messageTone}`} role="status">
      {messageTone === "success" ? <CheckCircle2 size={24} /> : <CircleAlert size={24} />}
      <div><strong>{messageTone === "success" ? "Votes cast" : "Couldn't cast your votes"}</strong><p>{message}</p></div>
      {messageTone === "success" && unlockedRemaining > 0 && <div className="ballotActionResultActions"><Button onClick={() => setMessage(null)}>Cast more votes</Button></div>}
      {messageTone === "error" && <div className="ballotActionResultActions">{messageAction === "retry" ? <Button onClick={() => request("verify")} disabled={busy}>{busy ? "Verifying…" : "Retry verification"}</Button> : messageAction === "profile" ? <Button href="/me">Open My profile</Button> : <Button onClick={messageAction === "restart" ? startAgain : () => setMessage(null)}>{messageAction === "restart" ? "Prepare a new post" : "Continue"}</Button>}</div>}
    </div> : <>
      <div className="ballotActionFields"><label className="formField"><span>Why are you voting? <small>(optional)</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Share why you’re helping choose the next OTFs…" rows={3} maxLength={120} disabled={busy || Boolean(challenge)} /><small>{reason.length} / 120 characters</small></label><label className="privacyChoice"><input type="checkbox" checked={revealVotes} disabled={busy || Boolean(challenge)} onChange={(event) => setRevealVotes(event.target.checked)} /><span><strong>Reveal my picks in this post</strong><small>{revealVotes ? addedChoices.length > 0 ? "The post will name the OTFs and vote counts in this batch." : "Your selected OTFs will appear after you add votes." : "Off by default. The OTFs receiving these votes will stay private."}</small></span></label></div>
      <div className="ballotActionPublish"><div className="xPostPreview compact"><div><span>{challenge ? "Ready to publish" : `Post preview · ${disclosurePreviewLabel}`}</span><Send size={13} /></div><p>{challenge?.postText ?? previewText}</p></div><Callout tone="warning"><strong>Publish the prepared text exactly as shown.</strong> Keep the post public and unchanged until final results are published. If it becomes invalid, this batch is void and its spent votes are not restored.</Callout>{challenge ? <div className="postAction"><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><p className="postAssurance">We never post anything on your behalf.</p></div> : <><Turnstile siteKey={turnstileSiteKey} action="vote_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} />{(!turnstileSiteKey || turnstileToken) && <div className="postAction"><Button onClick={() => request("prepare")} disabled={busy || newVotes < 1}>{busy ? "Preparing…" : <>Open X and post <ExternalLink size={14} /></>}</Button><p className="postAssurance">We never post anything on your behalf.</p></div>}</>}<label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" disabled={busy || !challenge} /><small>{challenge ? "Paste the URL of the public post containing the exact prepared text." : "Post to X first; this field will be ready after the post is prepared."}</small></label><Button onClick={() => request("verify")} disabled={busy || !challenge || !postUrl.trim()}>{busy ? "Verifying…" : `Verify and cast ${newVotes} ${newVotes === 1 ? "vote" : "votes"}`}</Button></div>
    </>}
  </SectionCard>;

  return <div className="ballotLayout"><SectionCard className="ballotCard"><div className="ballotToolbar"><div><span>Your vote ledger</span><small>Cast votes are permanent. Add newly unlocked votes at any time.</small></div><div className={`ballotTotal${newVotes > 0 ? " valid" : ""}`} aria-label={`${total} of ${availability.unlockedVotes} votes selected`}><strong>{total} / {availability.unlockedVotes}</strong></div></div>
    <form className="listSearch ballotListSearch" role="search" onSubmit={applySearch}><label htmlFor="ballot-search">Search proposals</label><div><Search size={16} aria-hidden="true" /><input id="ballot-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ticker, creator, or thesis" maxLength={100} disabled={Boolean(challenge)} /><Button type="submit" variant="secondary" disabled={listLoading || Boolean(challenge)}>Search</Button>{appliedQuery && <Button type="button" variant="ghost" onClick={clearSearch} disabled={listLoading || Boolean(challenge)}>Clear</Button>}</div></form>
    <div className="ballotRows">{proposals.length === 0 && appliedQuery ? <div className="ballotSearchEmpty"><strong>No matching proposals</strong><p>Try a ticker, OTF name, creator, or a broader phrase.</p></div> : proposals.map((proposal) => {
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
    <div className="listPagination ballotPagination" aria-live="polite"><span>{appliedQuery ? `${proposals.length} matching ${proposals.length === 1 ? "proposal" : "proposals"} shown` : `${proposals.length} of ${totalProposalCount} proposals shown`}</span>{nextCursor && <Button type="button" variant="secondary" onClick={loadMore} disabled={listLoading || Boolean(challenge)}>{listLoading ? "Loading…" : "Load more"}</Button>}</div>
    {listError && <p className="listLoadError" role="alert">{listError}</p>}
  </SectionCard><aside className="ballotRail"><SectionCard className="ballotSummary"><div className="ballotSummaryStatus"><div className="ballotSummaryCount"><span>Remaining votes</span><strong className={unlockedRemaining === 0 ? "complete" : ""}>{unlockedRemaining}</strong></div><p>{availability.nextVoteUnlockAt ? `Next vote unlocks ${formatDateTime(availability.nextVoteUnlockAt)}.` : `All ${rules.totalVotes} votes are unlocked. No vote is added on the final voting day.`}</p></div><div className="voteUnlockTrack" role="progressbar" aria-label="Votes unlocked" aria-valuemin={0} aria-valuemax={rules.totalVotes} aria-valuenow={availability.unlockedVotes}><span style={{ width: `${availability.unlockedVotes / rules.totalVotes * 100}%` }} /></div><small>{availability.unlockedVotes} of {rules.totalVotes} unlocked</small></SectionCard></aside>
    <div className="ballotActionArea">{actionPanel}</div>
  </div>;
}
