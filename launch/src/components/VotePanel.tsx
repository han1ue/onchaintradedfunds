"use client";

import { ExternalLink, Send, Vote } from "lucide-react";
import { useState } from "react";
import { errorMessages } from "@/lib/errors";
import { buildVotePost } from "@/lib/x-post";
import { Button, Callout, SectionCard } from "./ui";
import { Turnstile } from "./Turnstile";

type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

export function VotePanel({ proposal, connected, turnstileSiteKey, siteUrl }: { proposal: { id: string; name: string; ticker: string; slug: string }; connected: boolean; turnstileSiteKey?: string; siteUrl: string }) {
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [publishedPostUrl, setPublishedPostUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const previewText = buildVotePost(reason || "[You reason]", proposal, siteUrl, "[verification code]");

  async function request(action: "prepare" | "verify") {
    if (!connected) {
      window.location.href = "/api/auth/signin?callbackUrl=" + encodeURIComponent(window.location.pathname);
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/v1/proposals/${proposal.id}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "prepare" ? { reason, turnstileToken } : { challengeId: challenge?.challengeId, postUrl })
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      const code = typeof json.error?.code === "string" ? json.error.code : undefined;
      setMessage(code ? errorMessages[code] ?? code : "The X post could not be verified");
      return;
    }
    if (action === "prepare") setChallenge(json.data);
    else {
      setPublishedPostUrl(json.data.postUrl);
      setMessage("X post verified and vote counted.");
    }
  }

  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Cast a verified vote</span><small>Verified X account with at least 50 followers</small></div><Vote size={19} /></div><div className="panelBody">
    {!publishedPostUrl && !challenge && <><label className="formField"><span>Your reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why should this OTF launch?" rows={3} maxLength={120} /><small>{reason.length} / 120 characters · minimum 20</small></label><div className="xPostPreview compact"><div><span>Post preview</span><Send size={13} /></div><p>{previewText}</p></div><Callout>We’ll prepare this post with a one-time verification code. You publish it from X, then paste its URL here.</Callout><Turnstile siteKey={connected ? turnstileSiteKey : undefined} onToken={setTurnstileToken} /><Button onClick={() => request("prepare")} disabled={busy || reason.trim().length < 20 || Boolean(connected && turnstileSiteKey && !turnstileToken)}>{busy ? "Preparing…" : connected ? "Prepare X post" : "Connect X to vote"}</Button></>}
    {!publishedPostUrl && challenge && <div className="proofFlow"><div className="xPostPreview compact"><div><span>Ready to publish</span><Send size={13} /></div><p>{challenge.postText}</p></div><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /><small>Paste the URL of the public post containing the verification code.</small></label><Button onClick={() => request("verify")} disabled={busy || !postUrl.trim()}>{busy ? "Verifying…" : "Verify post and count vote"}</Button><Button variant="ghost" onClick={() => { setChallenge(null); setPostUrl(""); }}>Start again</Button></div>}
    {message && <p className="formMessage" role="status">{message}</p>}
    {publishedPostUrl && <a className="intentLink" href={publishedPostUrl} target="_blank" rel="noreferrer">View your verified X post <ExternalLink size={14} /></a>}
  </div></SectionCard>;
}
