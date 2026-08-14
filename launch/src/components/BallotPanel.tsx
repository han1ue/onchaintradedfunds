"use client";

import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { ExternalLink, Send, ShieldAlert, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { BallotSummary, LeaderboardEntry, ParticipationEligibility } from "@/lib/types";
import { errorMessages } from "@/lib/errors";
import { normalizeWholeNumberInput } from "@/lib/numeric-input";
import { buildVotePost } from "@/lib/x-post";
import { Button, SectionCard } from "./ui";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";

type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

function formatCooldownEnd(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function BallotPanel({
  proposals,
  ballot,
  eligibility,
  focusSlug,
  turnstileSiteKey,
  siteUrl,
}: {
  proposals: LeaderboardEntry[];
  ballot: BallotSummary | null;
  eligibility: ParticipationEligibility;
  focusSlug?: string;
  turnstileSiteKey?: string;
  siteUrl: string;
}) {
  const router = useRouter();
  const initialVotes = useMemo(() => {
    const values = Object.fromEntries(proposals.map((proposal) => [proposal.id, ""])) as Record<string, string>;
    for (const allocation of ballot?.allocations ?? []) {
      if (allocation.proposalId in values) values[allocation.proposalId] = String(allocation.votes);
    }
    if (!ballot && focusSlug) {
      const focused = proposals.find((proposal) => proposal.slug === focusSlug);
      if (focused) values[focused.id] = "100";
    }
    return values;
  }, [ballot, focusSlug, proposals]);
  const [votes, setVotes] = useState<Record<string, string>>(initialVotes);
  const [active, setActive] = useState(ballot?.status === "valid");
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(ballot?.updateAvailableAt ?? null);
  const [cooldownActive, setCooldownActive] = useState(Boolean(ballot && !ballot.canUpdate));
  const total = Object.values(votes).reduce((sum, value) => sum + Number(value || 0), 0);
  const remaining = 100 - total;
  const allocations = Object.entries(votes).map(([proposalId, value]) => ({ proposalId, votes: Number(value || 0) })).filter(({ votes: value }) => value > 0);
  const previewText = buildVotePost(reason || "[Why you are participating in OTF Launch…]", siteUrl, "[verification code]");

  useEffect(() => {
    if (!active || !cooldownUntil || !cooldownActive) return;
    const remainingMs = Date.parse(cooldownUntil) - Date.now();
    if (remainingMs <= 0) {
      setCooldownActive(false);
      return;
    }
    const timer = window.setTimeout(() => setCooldownActive(false), remainingMs);
    return () => window.clearTimeout(timer);
  }, [active, cooldownActive, cooldownUntil]);

  function updateVotes(proposalId: string, value: string) {
    setMessage(null);
    setVotes((current) => ({ ...current, [proposalId]: normalizeWholeNumberInput(value, 100) }));
  }

  async function request(action: "prepare" | "verify" | "update") {
    setBusy(true);
    setMessage(null);
    const body = action === "prepare"
      ? { action, reason, allocations, turnstileToken }
      : action === "verify"
        ? { action, challengeId: challenge?.challengeId, postUrl }
        : { action, allocations };
    const response = await fetch("/api/v1/ballot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      if (action === "prepare") setTurnstileResetKey((current) => current + 1);
      const code = typeof json.error?.code === "string" ? json.error.code : undefined;
      setMessage(code ? errorMessages[code] ?? code : "Your vote distribution could not be saved.");
      return;
    }
    if (action === "prepare") setChallenge(json.data);
    if (action === "verify") {
      setActive(true);
      setCooldownUntil(json.data.updateAvailableAt);
      setCooldownActive(true);
      setChallenge(null);
      setMessage("Your 100 votes are active. You can change the distribution after the 24-hour cooldown.");
      router.refresh();
    }
    if (action === "update") {
      setCooldownUntil(json.data.updateAvailableAt);
      setCooldownActive(true);
      setMessage("Your 100 votes have been redistributed. Another change will be available in 24 hours.");
      router.refresh();
    }
  }

  if (!proposals.length) return <SectionCard className="emptyState"><Vote size={28} /><h2>No OTF proposals available</h2><p>Your 100 votes can be distributed once proposals are live.</p></SectionCard>;
  if (!eligibility.eligible) return <SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers to activate and distribute your 100 votes.</p><EligibilityAction eligibility={eligibility} action="vote" callbackUrl="/vote" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in to distribute votes"}</EligibilityAction></SectionCard>;
  return <div className="ballotLayout"><SectionCard className="ballotCard"><div className="ballotToolbar"><div><span>Your distribution</span><small>{active ? "Active ballot · changes available once every 24 hours" : "Allocate all 100 votes to activate your ballot"}</small></div><div className={`ballotTotal${total === 100 ? " valid" : ""}`}><strong>{total}</strong><span>/ 100 votes</span></div></div>
    <div className="ballotRows">{proposals.map((proposal) => {
      return <div className="ballotRow" key={proposal.id}>
        <OtfTokenIcon ticker={proposal.ticker} size={38} />
        <div className="ballotIdentity"><strong>{proposal.name}</strong><span>${proposal.ticker} · {proposal.votes.toLocaleString()} votes</span></div>
        <label className="ballotVoteInput"><span className="srOnly">Votes for {proposal.name}</span><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={votes[proposal.id] ?? ""} onChange={(event) => updateVotes(proposal.id, event.target.value)} /><span>votes</span></label>
      </div>;
    })}</div>
  </SectionCard><aside className="ballotRail"><SectionCard className="ballotSummary"><div><span>Votes remaining</span><strong className={remaining === 0 ? "complete" : remaining < 0 ? "over" : ""}>{remaining}</strong></div>{remaining !== 100 && <p>{remaining === 0 ? `Your votes are distributed across ${allocations.length} ${allocations.length === 1 ? "proposal" : "proposals"}.` : remaining > 0 ? `Allocate ${remaining} more ${remaining === 1 ? "vote" : "votes"}.` : `Remove ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "vote" : "votes"}.`}</p>}</SectionCard>
    {active ? <SectionCard className="ballotAction"><strong>Update your ballot</strong><p>{cooldownActive && cooldownUntil ? `You can change your votes again after ${formatCooldownEnd(cooldownUntil)}.` : "You can redistribute now. Saving starts a new 24-hour cooldown."}</p>{ballot?.proofUrl && <a className="inlineLink" href={ballot.proofUrl} target="_blank" rel="noreferrer">View activation post <ExternalLink size={13} /></a>}<Button onClick={() => request("update")} disabled={busy || total !== 100 || cooldownActive}>{busy ? "Saving…" : cooldownActive ? "24-hour cooldown active" : "Save distribution"}</Button></SectionCard> : !challenge ? <SectionCard className="ballotAction"><strong>Activate your ballot</strong><p>Publish one X post to activate these 100 votes. You can redistribute after 24 hours without posting again.</p><label className="formField"><span>Why are you participating?</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Share why you’re helping choose the next OTFs…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters · minimum 20</small></label><div className="xPostPreview compact"><div><span>Post preview</span><Send size={13} /></div><p>{previewText}</p></div><Turnstile siteKey={turnstileSiteKey} action="vote_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} /><div className="postAction"><Button onClick={() => request("prepare")} disabled={busy || total !== 100 || reason.trim().length < 20 || Boolean(turnstileSiteKey && !turnstileToken)}>{busy ? "Preparing…" : "Prepare activation post"}</Button><p className="postAssurance">We never post anything on your behalf.</p></div></SectionCard> : <SectionCard className="ballotAction"><strong>Publish your activation post</strong><div className="xPostPreview compact"><div><span>Ready to publish</span><Send size={13} /></div><p>{challenge.postText}</p></div><div className="postAction"><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><p className="postAssurance">We never post anything on your behalf.</p></div><label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /></label><Button onClick={() => request("verify")} disabled={busy || !postUrl.trim()}>{busy ? "Verifying…" : "Verify post and activate votes"}</Button><Button variant="ghost" onClick={() => { setChallenge(null); setPostUrl(""); }}>Start again</Button></SectionCard>}
    {message && <p className="formMessage ballotMessage" role="status">{message}</p>}
  </aside></div>;
}
