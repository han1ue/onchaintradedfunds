"use client";

import { ExternalLink, Send, Vote } from "lucide-react";
import { useState } from "react";
import { errorMessages } from "@/lib/errors";
import { buildVotePost } from "@/lib/x-post";
import { Button, Callout, SectionCard } from "./ui";
import { Turnstile } from "./Turnstile";

export function VotePanel({ proposal, connected, turnstileSiteKey, siteUrl }: { proposal: { id: string; name: string; ticker: string; slug: string }; connected: boolean; turnstileSiteKey?: string; siteUrl: string }) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [publishedPostUrl, setPublishedPostUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const postText = buildVotePost(reason || "[You reason]", proposal, siteUrl);

  async function postVote() {
    if (!connected) {
      window.location.href = "/api/auth/signin?callbackUrl=" + encodeURIComponent(window.location.pathname);
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/v1/proposals/${proposal.id}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, turnstileToken })
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      const code = typeof json.error?.code === "string" ? json.error.code : undefined;
      setMessage(code ? errorMessages[code] ?? code : "X could not publish the vote post");
      return;
    }
    setPublishedPostUrl(json.data.postUrl);
    setMessage("Vote posted to X and counted.");
  }

  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Cast a verified vote</span><small>One vote per X account for this OTF</small></div><Vote size={19} /></div><div className="panelBody">
    {!publishedPostUrl && <><label className="formField"><span>Your reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why should this OTF launch?" rows={3} maxLength={120} /><small>{reason.length} / 120 characters · minimum 20</small></label><div className="xPostPreview compact"><div><span>Post preview</span><Send size={13} /></div><p>{postText}</p></div><Callout>Clicking below publishes this exact post to your connected X account and counts the vote.</Callout><Turnstile siteKey={connected ? turnstileSiteKey : undefined} onToken={setTurnstileToken} /><Button onClick={postVote} disabled={busy || reason.trim().length < 20 || Boolean(connected && turnstileSiteKey && !turnstileToken)}>{busy ? "Posting to X…" : connected ? "Post vote to X" : "Connect X to vote"}</Button></>}
    {message && <p className="formMessage" role="status">{message}</p>}
    {publishedPostUrl && <a className="intentLink" href={publishedPostUrl} target="_blank" rel="noreferrer">View your X post <ExternalLink size={14} /></a>}
  </div></SectionCard>;
}
