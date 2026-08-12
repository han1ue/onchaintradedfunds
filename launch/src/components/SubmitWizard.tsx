"use client";

import { Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompetitionSummary, EligibleAsset } from "@/lib/types";
import { Button, Callout, SectionCard } from "./ui";
import { Turnstile } from "./Turnstile";

type Row = { assetId: string; weight: number };
type Challenge = { challengeId: string; intentUrl: string; expiresAt: string };

export function SubmitWizard({ competition, assets, connected, turnstileSiteKey }: { competition: CompetitionSummary; assets: EligibleAsset[]; connected: boolean; turnstileSiteKey?: string }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(""); const [ticker, setTicker] = useState(""); const [thesis, setThesis] = useState("");
  const [rows, setRows] = useState<Row[]>([{ assetId: assets[0]?.id ?? "", weight: 50 }, { assetId: assets[1]?.id ?? "", weight: 50 }]);
  const [challenge, setChallenge] = useState<Challenge | null>(null); const [postUrl, setPostUrl] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.weight || 0), 0), [rows]);
  const preview = competition.id.startsWith("preview");

  function updateRow(index: number, patch: Partial<Row>) { setRows((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row)); }
  async function createProof() {
    if (!connected) { window.location.href = "/api/auth/signin?callbackUrl=%2Fsubmit"; return; }
    setBusy(true); setMessage(null);
    const response = await fetch("/api/v1/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ competitionId: competition.id, name, ticker: ticker.toUpperCase(), thesis, allocations: rows.map((row) => ({ assetId: row.assetId, weightBps: Math.round(row.weight * 100) })), turnstileToken }) });
    const json = await response.json();
    if (!response.ok) { setBusy(false); return setMessage(json.error?.code ?? "Draft could not be saved"); }
    const challengeResponse = await fetch(`/api/v1/submissions/${json.data.id}/challenge`, { method: "POST" });
    const challengeJson = await challengeResponse.json(); setBusy(false);
    if (!challengeResponse.ok) return setMessage(challengeJson.error?.code ?? "Proof could not be created");
    setChallenge(challengeJson.data); setStep(4); window.open(challengeJson.data.intentUrl, "_blank", "noopener,noreferrer");
  }
  async function verify() {
    if (!challenge) return; setBusy(true); setMessage(null);
    const response = await fetch("/api/v1/proofs/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, postUrl }) });
    const json = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(json.error?.code ?? "Proof could not be verified");
    window.location.href = `/otfs/${json.data.slug}`;
  }

  return <div className="wizardLayout"><SectionCard className="wizardCard">
    <div className="progressSteps">{["Basics", "Portfolio", "Review", "X proof"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="wizardBody">
      {preview && <Callout tone="warning">Preview data is active because the launch database is not configured. The complete interface is available, but submissions will not persist.</Callout>}
      {step === 1 && <div className="formStack"><label className="formField"><span>OTF name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI Infrastructure OTF" maxLength={80} /><small>Must end in “OTF”.</small></label><label className="formField"><span>Ticker</span><input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="AIX" maxLength={16} /></label><label className="formField"><span>Investment thesis</span><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="Explain what this portfolio owns, why it belongs together, and the long-term case…" rows={7} /><small>{new TextEncoder().encode(thesis).length} / 2,048 bytes</small></label></div>}
      {step === 2 && <div className="formStack"><div className="allocationTotal"><span>Portfolio allocation</span><strong className={total === 100 ? "valid" : ""}>{total}%</strong></div>{rows.map((row, index) => <div className="allocationInput" key={index}><label className="formField"><span>Asset {index + 1}</span><select value={row.assetId} onChange={(event) => updateRow(index, { assetId: event.target.value })}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><label className="formField weightField"><span>Weight</span><div><input type="number" min="1" max="99" value={row.weight} onChange={(event) => updateRow(index, { weight: Number(event.target.value) })} /><span>%</span></div></label>{rows.length > 2 && <button className="removeButton" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove asset ${index + 1}`}><Trash2 size={16} /></button>}</div>)}<Button variant="secondary" onClick={() => setRows((current) => [...current, { assetId: assets.find((asset) => !current.some((row) => row.assetId === asset.id))?.id ?? assets[0]?.id ?? "", weight: 1 }])} disabled={rows.length >= assets.length}><Plus size={15} /> Add asset</Button></div>}
      {step === 3 && <div className="reviewBlock"><div><span>Name</span><strong>{name}</strong></div><div><span>Ticker</span><strong>${ticker}</strong></div><div><span>Thesis</span><p>{thesis}</p></div><div><span>Portfolio</span><ul>{rows.map((row) => <li key={row.assetId}><span>{assets.find((asset) => asset.id === row.assetId)?.symbol}</span><strong>{row.weight}%</strong></li>)}</ul></div><Callout>Submitting locks the proposal. You will have 30 minutes to publish and verify your X post.</Callout><Turnstile siteKey={connected ? turnstileSiteKey : undefined} onToken={setTurnstileToken} /></div>}
      {step === 4 && challenge && <div className="formStack"><Callout>Write at least 20 characters of your own context on X. Keep the generated proof link in the post.</Callout><a className="intentLink" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X post composer <ExternalLink size={14} /></a><label className="formField"><span>Published X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/you/status/…" /></label><Button onClick={verify} disabled={busy || !postUrl}>{busy ? "Verifying…" : "Verify and publish OTF"}</Button></div>}
      {message && <p className="formMessage" role="status">{message}</p>}
    </div>
      {step < 4 && <div className="wizardFooter"><Button variant="secondary" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1}>Back</Button>{step < 3 ? <Button onClick={() => setStep((current) => current + 1)} disabled={step === 1 ? !name.endsWith(" OTF") || ticker.length < 1 || thesis.length < 20 : total !== 100 || new Set(rows.map((row) => row.assetId)).size !== rows.length}>Continue</Button> : <Button onClick={createProof} disabled={busy || preview || Boolean(connected && turnstileSiteKey && !turnstileToken)}>{busy ? "Checking…" : connected ? "Lock and create X proof" : "Connect X to submit"}</Button>}</div>}
  </SectionCard><aside><SectionCard className="sideNote"><strong>Before you submit</strong><ul><li>One accepted proposal per X account.</li><li>At least two eligible assets.</li><li>Every asset must have a usable direct V3 pool.</li><li>Weights must total exactly 100%.</li><li>Accepted proposals cannot be edited.</li></ul></SectionCard></aside></div>;
}
