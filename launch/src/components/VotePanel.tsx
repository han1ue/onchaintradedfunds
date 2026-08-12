"use client";

import { ExternalLink, Vote } from "lucide-react";
import { useState } from "react";
import { Button, Callout, SectionCard } from "./ui";
import { Turnstile } from "./Turnstile";

type Challenge = { challengeId: string; intentUrl: string; expiresAt: string };

export function VotePanel({ proposalId, connected, turnstileSiteKey }: { proposalId: string; connected: boolean; turnstileSiteKey?: string }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  async function startVote() {
    if (!connected) { window.location.href = "/api/auth/signin?callbackUrl=" + encodeURIComponent(window.location.pathname); return; }
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/v1/proposals/${proposalId}/vote-challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken }) });
    const json = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(json.error?.code ?? "Unable to start vote");
    setChallenge(json.data); window.open(json.data.intentUrl, "_blank", "noopener,noreferrer");
  }

  async function verify() {
    if (!challenge) return; setBusy(true); setMessage(null);
    const response = await fetch("/api/v1/proofs/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, postUrl }) });
    const json = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(json.error?.code ?? "Proof could not be verified");
    setMessage("Vote verified and counted."); setChallenge(null);
  }

  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Cast a verified vote</span><small>One vote per X account for this OTF</small></div><Vote size={19} /></div><div className="panelBody">
    {!challenge ? <><Turnstile siteKey={connected ? turnstileSiteKey : undefined} onToken={setTurnstileToken} /><Button onClick={startVote} disabled={busy || Boolean(connected && turnstileSiteKey && !turnstileToken)}>{busy ? "Checking eligibility…" : connected ? "Vote with X" : "Connect X to vote"}</Button></> : <>
      <Callout>Post your reason on X, then paste the public post URL below. The proof expires at {new Date(challenge.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Callout>
      <a className="intentLink" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X post composer <ExternalLink size={14} /></a>
      <label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/you/status/…" /></label>
      <Button onClick={verify} disabled={busy || !postUrl}>{busy ? "Verifying…" : "Verify and count vote"}</Button>
    </>}
    {message && <p className="formMessage" role="status">{message}</p>}
  </div></SectionCard>;
}
