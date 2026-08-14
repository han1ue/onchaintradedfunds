"use client";

import { Check, ExternalLink, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompetitionSummary, EligibleAsset, ParticipationEligibility } from "@/lib/types";
import { errorMessages } from "@/lib/errors";
import { buildSubmissionPost, slugifyProposalName } from "@/lib/x-post";
import { Button, Callout, SectionCard } from "./ui";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";

type Row = { assetId: string; weight: number };
type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

function friendlyError(code: string | undefined, fallback: string) {
  return code ? errorMessages[code] ?? code : fallback;
}

export function SubmitWizard({ competition, assets, eligibility, turnstileSiteKey, siteUrl }: { competition: CompetitionSummary; assets: EligibleAsset[]; eligibility: ParticipationEligibility; turnstileSiteKey?: string; siteUrl: string }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [thesis, setThesis] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([{ assetId: assets[0]?.id ?? "", weight: 50 }, { assetId: assets[1]?.id ?? "", weight: 50 }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.weight || 0), 0), [rows]);
  const hasEnoughAssets = assets.length >= 2;
  const preview = competition.id.startsWith("preview");
  const postText = buildSubmissionPost(reason || "[You reason]", { name: name || "Your OTF", ticker: ticker || "TICKER", slug: slugifyProposalName(name || "Your OTF") }, siteUrl, "[verification code]");

  if (!eligibility.eligible) return <div className="wizardLayout"><SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Creating an OTF is limited to verified, public X accounts with at least {eligibility.minFollowers.toLocaleString()} followers. Please connect an eligible account.</p><EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/submit" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></SectionCard><aside><SectionCard className="sideNote"><strong>Participation requirements</strong><ul><li>Verified and public X account.</li><li>At least {eligibility.minFollowers.toLocaleString()} followers.</li><li>Account at least {eligibility.minAccountAgeDays} days old.</li></ul></SectionCard></aside></div>;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  }

  async function postSubmission() {
    setBusy(true);
    setMessage(null);
    if (challenge && draftId) {
      const verifyResponse = await fetch(`/api/v1/submissions/${draftId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, postUrl })
      });
      const verifyJson = await verifyResponse.json();
      setBusy(false);
      if (!verifyResponse.ok) {
        setMessage(friendlyError(verifyJson.error?.code, "The X post could not be verified"));
        return;
      }
      window.location.href = `/otfs/${verifyJson.data.slug}`;
      return;
    }
    const draftResponse = await fetch("/api/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        competitionId: competition.id,
        name,
        ticker: ticker.toUpperCase(),
        thesis,
        allocations: rows.map((row) => ({ assetId: row.assetId, weightBps: Math.round(row.weight * 100) }))
      })
    });
    const draftJson = await draftResponse.json();
    if (!draftResponse.ok) {
      setBusy(false);
      setMessage(friendlyError(draftJson.error?.code, "Draft could not be saved"));
      return;
    }
    setDraftId(draftJson.data.id);
    const publishResponse = await fetch(`/api/v1/submissions/${draftJson.data.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, turnstileToken })
    });
    const publishJson = await publishResponse.json();
    setBusy(false);
    if (!publishResponse.ok) {
      setTurnstileResetKey((current) => current + 1);
      setMessage(friendlyError(publishJson.error?.code, "The X post could not be prepared"));
      return;
    }
    setChallenge(publishJson.data);
  }

  return <div className="wizardLayout"><SectionCard className="wizardCard">
    <div className="progressSteps">{["Basics", "Portfolio", "Review", "X post"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="wizardBody">
      {preview && <Callout tone="warning">Preview data is active because the launch database is not configured. The complete interface is available, but submissions will not persist.</Callout>}
      {step === 1 && <div className="formStack"><label className="formField"><span>OTF name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI Infrastructure OTF" maxLength={80} /><small>Must end in “OTF”.</small></label><label className="formField"><span>Ticker</span><input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="AIX" maxLength={16} /></label><label className="formField"><span>Investment thesis</span><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="Explain what this portfolio owns, why it belongs together, and the long-term case…" rows={7} /><small>{new TextEncoder().encode(thesis).length} / 2,048 bytes</small></label></div>}
      {step === 2 && <div className="formStack">{!hasEnoughAssets ? <Callout tone="danger">No portfolio assets are available. At least two assets must be added to Supported RWAs before submissions can open.</Callout> : <><div className="allocationTotal"><span>Portfolio allocation</span><strong className={total === 100 ? "valid" : ""}>{total}%</strong></div>{rows.map((row, index) => <div className="allocationInput" key={index}><label className="formField"><span>Asset {index + 1}</span><select value={row.assetId} onChange={(event) => updateRow(index, { assetId: event.target.value })}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><label className="formField weightField"><span>Weight</span><div><input type="number" min="1" max="99" value={row.weight} onChange={(event) => updateRow(index, { weight: Number(event.target.value) })} /><span>%</span></div></label>{rows.length > 2 && <button className="removeButton" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove asset ${index + 1}`}><Trash2 size={16} /></button>}</div>)}<Button variant="secondary" onClick={() => setRows((current) => [...current, { assetId: assets.find((asset) => !current.some((row) => row.assetId === asset.id))?.id ?? assets[0]?.id ?? "", weight: 1 }])} disabled={rows.length >= assets.length}><Plus size={15} /> Add asset</Button></>}</div>}
      {step === 3 && <div className="reviewBlock"><div><span>Name</span><strong>{name}</strong></div><div><span>Ticker</span><strong>${ticker}</strong></div><div><span>Thesis</span><p>{thesis}</p></div><div><span>Portfolio</span><ul>{rows.map((row) => <li key={row.assetId}><span>{assets.find((asset) => asset.id === row.assetId)?.symbol}</span><strong>{row.weight}%</strong></li>)}</ul></div><Callout>Submitting locks this proposal. The final step shows the exact X post for your approval.</Callout></div>}
      {step === 4 && !challenge && <div className="formStack"><label className="formField"><span>Your context</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this OTF deserves to launch…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters · minimum 20</small></label><div className="xPostPreview"><div><span>Post preview</span><Send size={14} /></div><p>{postText}</p></div><Callout>We’ll prepare this post with a one-time verification code. You publish it from X, then paste its URL here.</Callout><Turnstile siteKey={turnstileSiteKey} action="submit_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} /></div>}
      {step === 4 && challenge && <div className="proofFlow"><div className="xPostPreview"><div><span>Ready to publish</span><Send size={14} /></div><p>{challenge.postText}</p></div><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /><small>Paste the URL of the public post containing the verification code.</small></label></div>}
      {message && <p className="formMessage" role="status">{message}</p>}
    </div>
    <div className="wizardFooter"><Button variant="secondary" onClick={() => challenge ? setChallenge(null) : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || busy}>{challenge ? "Start again" : "Back"}</Button>{step < 4 ? <Button onClick={() => setStep((current) => current + 1)} disabled={step === 1 ? !name.endsWith(" OTF") || ticker.length < 1 || thesis.length < 20 : step === 2 ? !hasEnoughAssets || total !== 100 || new Set(rows.map((row) => row.assetId)).size !== rows.length : false}>Continue</Button> : <Button onClick={postSubmission} disabled={busy || preview || (challenge ? !postUrl.trim() : reason.trim().length < 20 || Boolean(turnstileSiteKey && !turnstileToken))}>{busy ? (challenge ? "Verifying…" : "Preparing…") : challenge ? "Verify post and submit OTF" : "Prepare X post"}</Button>}</div>
  </SectionCard><aside><SectionCard className="sideNote"><strong>Before you submit</strong><ul><li>Verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers.</li><li>One accepted proposal per X account.</li><li>At least two supported RWAs.</li><li>Weights must total exactly 100%.</li><li>Accepted proposals cannot be edited.</li></ul></SectionCard></aside></div>;
}
