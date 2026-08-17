"use client";

import { Check, ExternalLink, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { deriveOtfQuality } from "@/lib/asset-quality";
import { errorMessages } from "@/lib/errors";
import { normalizeWholeNumberInput } from "@/lib/numeric-input";
import {
  emptyPricingConfig,
  preferredPricingConfig,
  pricingConfigComplete,
  pricingConfigSummary,
} from "@/lib/pricing-config";
import { normalizeTickerInput } from "@/lib/ticker";
import type { CompetitionSummary, EligibleAsset, ParticipationEligibility, PricingConfig, ProposalAssetMetadata } from "@/lib/types";
import { buildSubmissionPost, slugifyProposalName } from "@/lib/x-post";
import { AssetMarketPicker } from "./AssetMarketPicker";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";
import { Button, Callout, SectionCard } from "./ui";

type Row = { assetId: string; assetMetadata: ProposalAssetMetadata | null; pricingConfig: PricingConfig | null; weight: string };
type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

function friendlyError(code: string | undefined, fallback: string) {
  return code ? errorMessages[code] ?? code : fallback;
}

function initialRow(asset: EligibleAsset | undefined, weight: string): Row {
  return {
    assetId: asset?.id ?? "",
    assetMetadata: null,
    pricingConfig: asset
      ? preferredPricingConfig(asset.pricingConfigs) ?? emptyPricingConfig("uniswap-v3")
      : null,
    weight,
  };
}

export function SubmitWizard({ competition, assets, eligibility, turnstileSiteKey, siteUrl }: {
  competition: CompetitionSummary;
  assets: EligibleAsset[];
  eligibility: ParticipationEligibility;
  turnstileSiteKey?: string;
  siteUrl: string;
}) {
  const verifiedAssets = useMemo(() => assets.filter((asset) => (
    asset.quality === "high" && Boolean(preferredPricingConfig(asset.pricingConfigs))
  )), [assets]);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [thesis, setThesis] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([initialRow(verifiedAssets[0], "50"), initialRow(verifiedAssets[1], "50")]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.weight || 0), 0), [rows]);
  const thesisBytes = new TextEncoder().encode(thesis).length;
  const thesisValid = thesis.trim().length > 0 && thesisBytes <= 2048;
  const selectedAssets = rows.map((row) => assets.find((asset) => asset.id === row.assetId));
  const quality = deriveOtfQuality(rows.map((row, index) => selectedAssets[index]?.quality ?? (row.assetMetadata ? "normal" : undefined)));
  const rowIdentities = rows.map((row, index) => {
    const selected = selectedAssets[index];
    if (selected) return `${selected.network}:${selected.contractAddress.toLowerCase()}`;
    if (row.assetMetadata) return `${row.assetMetadata.network}:${row.assetMetadata.contractAddress.toLowerCase()}`;
    return "";
  });
  const allAssetsSelected = rowIdentities.every(Boolean);
  const assetsUnique = new Set(rowIdentities).size === rows.length;
  const allPricingReady = rows.every((row) => Boolean(
    (assets.some((asset) => asset.id === row.assetId) || row.assetMetadata) && pricingConfigComplete(row.pricingConfig),
  ));
  const preview = competition.id.startsWith("preview");
  const postText = buildSubmissionPost(reason, {
    name: name || "Your OTF",
    ticker: ticker || "TICKER",
    slug: slugifyProposalName(name || "Your OTF"),
  }, siteUrl, "[verification code]");

  if (!eligibility.eligible) return <div className="wizardLayout"><SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Submitting an OTF proposal requires a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers. Please connect an eligible account.</p><EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/submit" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></SectionCard><aside><SectionCard className="sideNote"><strong>Proposal requirements</strong><ul><li>Use a verified, public X account.</li><li>Have at least {eligibility.minFollowers.toLocaleString()} followers.</li><li>Use an account that is at least {eligibility.minAccountAgeDays} days old.</li></ul></SectionCard></aside></div>;

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
        body: JSON.stringify({ challengeId: challenge.challengeId, postUrl }),
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
        name,
        ticker: normalizeTickerInput(ticker),
        thesis,
        allocations: rows.map((row) => ({
          ...(row.assetId ? { assetId: row.assetId } : { assetMetadata: row.assetMetadata }),
          pricingConfig: row.pricingConfig,
          weightBps: Math.round(Number(row.weight || 0) * 100),
        })),
      }),
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
      body: JSON.stringify({ reason, turnstileToken }),
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
      {preview && <Callout tone="warning">Preview data is active because the launch database is not configured. The complete interface is available, but proposals will not be saved.</Callout>}
      {step === 1 && <div className="formStack"><label className="formField"><span>OTF name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI Infrastructure OTF" maxLength={80} /><small>Must end in “OTF”.</small></label><label className="formField"><span>Ticker</span><input value={ticker} onChange={(event) => setTicker(normalizeTickerInput(event.target.value))} placeholder="AIX" maxLength={16} /></label><label className="formField"><span>Investment thesis</span><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="Explain what this portfolio owns, why it belongs together, and the long-term case…" rows={7} /><small className={`thesisCounter${thesisBytes > 2048 ? " invalid" : ""}`} aria-live="polite">{thesisBytes.toLocaleString()} / 2,048 bytes maximum</small></label></div>}
      {step === 2 && <div className="formStack">{verifiedAssets.length === 0 && <Callout>No verified assets are available yet. Search for a Robinhood Chain contract address to submit an 18-decimal token and qualifying Uniswap V3 pool for review.</Callout>}<div><div className="allocationTotal"><span>Portfolio allocation · {rows.length} assets <small>(2 minimum)</small></span><strong className={total === 100 ? "valid" : ""}>{total}%</strong></div><p className="assetDirectoryPrompt">Choose from verified assets; their approved price sources are already configured. If an asset is not listed, search its contract address to add a qualifying Uniswap V3 pool.</p></div>{rows.map((row, index) => <div className="allocationInput" key={index}><AssetMarketPicker assets={verifiedAssets} assetId={row.assetId} assetMetadata={row.assetMetadata} pricingConfig={row.pricingConfig} label={`Asset ${index + 1}`} onChange={(assetId, assetMetadata, pricingConfig) => updateRow(index, { assetId, assetMetadata, pricingConfig })} /><label className="formField weightField"><span>Weight</span><div><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={row.weight} onChange={(event) => updateRow(index, { weight: normalizeWholeNumberInput(event.target.value, 99) })} /><span>%</span></div></label>{rows.length > 2 && <button className="removeButton" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove asset ${index + 1}`}><Trash2 size={16} /></button>}</div>)}<Callout><strong>Unlisted assets require review.</strong> Their pool must be at least 7 days old before deployment, hold $10,000 or more in active liquidity, and represent a token above $1 million market cap on CoinMarketCap.</Callout><Button variant="secondary" onClick={() => setRows((current) => { const asset = verifiedAssets.find((candidate) => !current.some((row) => row.assetId === candidate.id)); return [...current, initialRow(asset, "1")]; })}><Plus size={15} /> Add another asset</Button></div>}
      {step === 3 && <div className="reviewBlock"><div><span>Live verification</span><strong>{quality === "high" ? "Verified" : "Review required"}</strong><small>An OTF is verified only when every constituent is verified. Unlisted assets are checked before deployment.</small></div><div><span>Name</span><strong>{name}</strong></div><div><span>Ticker</span><strong>${ticker}</strong></div><div><span>Thesis</span><p>{thesis}</p></div><div><span>Portfolio</span><ul>{rows.map((row, index) => { const asset = assets.find((candidate) => candidate.id === row.assetId); const metadata = asset ?? row.assetMetadata; return <li key={`${rowIdentities[index]}:${index}`}><span>{metadata?.symbol} · {metadata?.contractAddress}{row.pricingConfig ? ` · ${pricingConfigSummary(row.pricingConfig)}` : ""}</span><strong>{row.weight}%</strong></li>; })}</ul></div><Callout>Submitting locks each verified asset&apos;s approved price source and any Uniswap V3 pool you supplied for an unlisted asset. Onchain validation remains authoritative.</Callout></div>}
      {step === 4 && !challenge && <div className="formStack"><label className="formField"><span>Your context <small>(optional)</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this OTF deserves to launch…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters</small></label><div className="xPostPreview"><div><span>Post preview</span><Send size={14} /></div><p>{postText}</p></div><Callout>We’ll prepare this post with a one-time verification code. You publish it from X, then paste its URL here.</Callout><Turnstile siteKey={turnstileSiteKey} action="submit_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} /></div>}
      {step === 4 && challenge && <div className="proofFlow"><div className="xPostPreview"><div><span>Ready to publish</span><Send size={14} /></div><p>{challenge.postText}</p></div><div className="postAction"><a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a><p className="postAssurance">We never post anything on your behalf.</p></div><label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" /><small>Paste the URL of the public post containing the verification code.</small></label></div>}
      {message && <p className="formMessage" role="status">{message}</p>}
    </div>
    <div className="wizardFooter"><Button variant="secondary" onClick={() => challenge ? setChallenge(null) : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || busy}>{challenge ? "Start again" : "Back"}</Button>{step < 4 ? <Button onClick={() => setStep((current) => current + 1)} disabled={step === 1 ? !name.endsWith(" OTF") || ticker.length < 1 || !thesisValid : step === 2 ? !allAssetsSelected || !allPricingReady || total !== 100 || !assetsUnique : false}>Continue</Button> : <div className="wizardFooterAction"><Button onClick={postSubmission} disabled={busy || preview || (challenge ? !postUrl.trim() : Boolean(turnstileSiteKey && !turnstileToken))}>{busy ? (challenge ? "Verifying…" : "Preparing…") : challenge ? "Verify post and submit proposal" : "Prepare X post"}</Button>{!challenge && <p className="postAssurance">We never post anything on your behalf.</p>}</div>}</div>
  </SectionCard><aside><SectionCard className="sideNote"><strong>Before you submit a proposal</strong><ul><li>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers.</li><li>One OTF proposal per X account.</li><li>Choose at least two 18-decimal assets.</li><li>Verified assets already include an approved price source.</li><li>Unlisted assets require a qualifying Uniswap V3 pool.</li><li>Weights must total exactly 100%.</li><li>Submitted proposals cannot be edited.</li></ul></SectionCard></aside></div>;
}
