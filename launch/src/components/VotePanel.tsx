"use client";

import { ExternalLink, Send, ShieldAlert, Vote } from "lucide-react";
import { useState } from "react";
import { errorMessages } from "@/lib/errors";
import type { ParticipationEligibility } from "@/lib/types";
import { buildVotePost } from "@/lib/x-post";
import { Button, Callout, SectionCard } from "./ui";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";
import { XPostEmbed } from "./XPostEmbed";

type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

export function VotePanel({ proposal, eligibility, isCreator, turnstileSiteKey, siteUrl }: { proposal: { id: string; name: string; ticker: string; slug: string }; eligibility: ParticipationEligibility; isCreator: boolean; turnstileSiteKey?: string; siteUrl: string }) {
  const [reason, setReason] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [publishedPostUrl, setPublishedPostUrl] = useState<string | null>(null);
  const [publishedPostHtml, setPublishedPostHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const previewText = buildVotePost(reason || "[This OTF is great because…]", proposal, siteUrl, "[verification code]");

  async function request(action: "prepare" | "verify") {
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
      if (action === "prepare") setTurnstileResetKey((current) => current + 1);
      const code = typeof json.error?.code === "string" ? json.error.code : undefined;
      setMessage(code ? errorMessages[code] ?? code : "The X post could not be verified");
      return;
    }
    if (action === "prepare") setChallenge(json.data);
    else {
      setPublishedPostUrl(json.data.postUrl);
      setPublishedPostHtml(typeof json.data.embedHtml === "string" ? json.data.embedHtml : null);
      setMessage("X post verified and vote counted.");
    }
  }

  return <SectionCard className="votePanel"><div className="cardHeading"><div><span>Cast a verified vote</span><small>{isCreator ? "Proposal creators cannot vote for their own OTF" : <>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers</>}</small></div><Vote size={19} /></div><div className="panelBody">
    {isCreator && <div className="eligibilityPrompt"><ShieldAlert size={22} aria-hidden="true" /><strong>This is your proposal</strong><p>You cannot vote for your own OTF. Your proposal starts with zero verified votes and must earn support from other eligible accounts.</p></div>}
    {!isCreator && !eligibility.eligible && <div className="eligibilityPrompt"><ShieldAlert size={22} aria-hidden="true" /><strong>Eligible X account required</strong><p>Voting is limited to verified, public accounts with at least {eligibility.minFollowers.toLocaleString()} followers.</p><EligibilityAction eligibility={eligibility} action="vote" callbackUrl={`/otfs/${proposal.slug}`}>{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></div>}
    {!isCreator && eligibility.eligible && !publishedPostUrl && !challenge && <><label className="formField"><span>This OTF is great because…</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this proposal should launch…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters · minimum 20</small></label><div className="xPostPreview compact"><div><span>Post preview</span><Send size={13} /></div><p>{previewText}</p></div><Callout>We’ll prepare this post with a one-time verification code. You publish it from X, then paste its URL here.</Callout><Turnstile siteKey={turnstileSiteKey} action="vote_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} /><Button onClick={() => request("prepare")} disabled={busy || reason.trim().length < 20 || Boolean(turnstileSiteKey && !turnstileToken)}>{busy ? "Preparing…" : "Prepare X post"}</Button></>}
    {!isCreator && !publishedPostUrl && challenge && <div className="proofFlow"><div className="xPostPreview compact"><div><span>Ready to publish</span><Send size={13} /></div><p>{challenge.postText}</p></div><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /><small>Paste the URL of the public post containing the verification code.</small></label><Button onClick={() => request("verify")} disabled={busy || !postUrl.trim()}>{busy ? "Verifying…" : "Verify post and count vote"}</Button><Button variant="ghost" onClick={() => { setChallenge(null); setPostUrl(""); }}>Start again</Button></div>}
    {message && <p className="formMessage" role="status">{message}</p>}
    {publishedPostUrl && <XPostEmbed html={publishedPostHtml} postUrl={publishedPostUrl} />}
  </div></SectionCard>;
}
