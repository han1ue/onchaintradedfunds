"use client";

import { AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deriveOtfVerified } from "@/lib/asset-verification";
import { requestWithChallengeReconciliation } from "@/lib/challenge-reconciliation";
import { errorMessages } from "@/lib/errors";
import { shortAddress } from "@/lib/format-address";
import { normalizeWholeNumberInput } from "@/lib/numeric-input";
import { preferredActiveMarketPricingConfig, pricingConfigComplete, pricingConfigSummary } from "@/lib/pricing-config";
import { normalizeTickerInput } from "@/lib/ticker";
import type { AssetRegistryEntry, CompetitionSummary, ParticipationEligibility, PricingConfig, ProposalAssetMetadata, ProposalDraft } from "@/lib/types";
import { buildSubmissionPost, isValidXPostUrl, slugifyProposalName } from "@/lib/x-post";
import { AssetMarketPicker } from "./AssetMarketPicker";
import { EligibilityAction } from "./EligibilityGate";
import { Turnstile } from "./Turnstile";
import { Button, Callout, SectionCard, StatusBadge } from "./ui";

type Row = { assetId: string; assetMetadata: ProposalAssetMetadata | null; pricingConfig: PricingConfig | null; weight: string };
type Challenge = { challengeId: string; intentUrl: string; postText: string; expiresAt: string };

function friendlyError(code: string | undefined, fallback: string) {
  return code ? errorMessages[code] ?? code : fallback;
}

function ValidationIssues({ id, title, issues }: { id: string; title: string; issues: string[] }) {
  if (issues.length === 0) return null;
  return <div id={id} className="callout warning validationIssues" role="status" aria-live="polite"><AlertTriangle size={15} aria-hidden="true" /><div><strong>{title}</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div>;
}

function initialRow(asset: AssetRegistryEntry | undefined, weight: string): Row {
  return {
    assetId: asset?.id ?? "",
    assetMetadata: null,
    pricingConfig: asset && !asset.verified ? preferredActiveMarketPricingConfig(asset.markets) : null,
    weight,
  };
}

function draftRows(draft: ProposalDraft | null, assets: AssetRegistryEntry[]): Row[] {
  if (!draft) return [initialRow(assets.filter((asset) => asset.verified)[0], "50"), initialRow(assets.filter((asset) => asset.verified)[1], "50")];
  return draft.allocations.map((allocation) => ({
    assetId: "assetId" in allocation ? allocation.assetId : "",
    assetMetadata: "assetMetadata" in allocation ? allocation.assetMetadata : null,
    pricingConfig: allocation.pricingConfig ?? null,
    weight: String(allocation.weightBps / 100),
  }));
}

export function SubmitWizard({ competition, assets, eligibility, initialDraft = null, confirmedProposalCount, turnstileSiteKey }: {
  competition: CompetitionSummary;
  assets: AssetRegistryEntry[];
  eligibility: ParticipationEligibility;
  initialDraft?: ProposalDraft | null;
  confirmedProposalCount: number;
  turnstileSiteKey?: string;
}) {
  const verifiedAssets = useMemo(() => assets.filter((asset) => asset.verified), [assets]);
  const [step, setStep] = useState(initialDraft ? 4 : 1);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [ticker, setTicker] = useState(initialDraft?.ticker ?? "");
  const [thesis, setThesis] = useState(initialDraft?.thesis ?? "");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>(() => draftRows(initialDraft, assets));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [postUrl, setPostUrl] = useState("");
  const [successSlug, setSuccessSlug] = useState<string | null>(null);
  const [profileRecovery, setProfileRecovery] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(5);
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.weight || 0), 0), [rows]);
  const minimumWeightPercent = competition.rules.minAssetWeightBps / 100;
  const portfolioWeightPercent = competition.rules.portfolioWeightBps / 100;
  const allWeightsMeetMinimum = rows.every((row) => Number(row.weight || 0) >= minimumWeightPercent);
  const thesisBytes = new TextEncoder().encode(thesis).length;
  const nameValid = name.length >= 5 && name.endsWith(" OTF");
  const tickerValid = /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(ticker);
  const thesisValid = thesis.trim().length > 0 && thesisBytes <= 2048;
  const selectedAssets = rows.map((row) => assets.find((asset) => asset.id === row.assetId));
  const verified = deriveOtfVerified(rows.map((row, index) => selectedAssets[index]?.verified ?? (row.assetMetadata ? false : undefined)));
  const rowIdentities = rows.map((row, index) => {
    const selected = selectedAssets[index];
    if (selected) return `${selected.network}:${selected.contractAddress.toLowerCase()}`;
    if (row.assetMetadata) return `${row.assetMetadata.network}:${row.assetMetadata.contractAddress.toLowerCase()}`;
    return "";
  });
  const allAssetsSelected = rowIdentities.every(Boolean);
  const assetsUnique = new Set(rowIdentities).size === rows.length;
  const allPricingReady = rows.every((row) => {
    const asset = assets.find((candidate) => candidate.id === row.assetId);
    const assetExists = Boolean(asset || row.assetMetadata);
    return assetExists && (asset?.verified || pricingConfigComplete(row.pricingConfig));
  });
  const preview = competition.id.startsWith("preview");
  const proposalLimit = competition.rules.maxProposalsPerAccount;
  const atProposalLimit = proposalLimit !== null && confirmedProposalCount >= proposalLimit;
  const postText = buildSubmissionPost(reason, {
    name: name || "Your OTF",
    ticker: ticker || "TICKER",
    slug: slugifyProposalName(name || "Your OTF"),
  }, "[verification code]");
  const validPostUrl = isValidXPostUrl(postUrl);
  const basicsIssues = [
    nameValid ? null : "Enter a name ending in ‘ OTF’ (for example, ‘AI Infrastructure OTF’).",
    tickerValid ? null : "Enter a ticker using letters, numbers, or hyphens.",
    thesis.trim().length > 0 ? null : "Write an investment thesis.",
    thesisBytes <= 2048 ? null : "Shorten the investment thesis to 2,048 bytes or fewer.",
  ].filter((issue): issue is string => Boolean(issue));
  const portfolioIssues = [
    rows.length >= competition.rules.minAssets ? null : `Choose at least ${competition.rules.minAssets} assets.`,
    allAssetsSelected ? null : "Choose an asset for every portfolio row.",
    !allAssetsSelected || assetsUnique ? null : "Each asset can appear only once.",
    !allAssetsSelected || allPricingReady ? null : "Complete the pricing setup for every selected unverified asset.",
    allWeightsMeetMinimum ? null : `Allocate at least ${minimumWeightPercent}% to every asset.`,
    total === portfolioWeightPercent ? null : `Adjust the weights to exactly ${portfolioWeightPercent}%. Current total: ${total}%.`,
  ].filter((issue): issue is string => Boolean(issue));
  const proofIssues = challenge ? [
    draftId ? null : "This submission session is out of date. Start again to prepare a new X post.",
    postUrl.trim().length > 0 ? null : "Paste the public X post URL.",
    postUrl.trim().length === 0 || validPostUrl ? null : "Use a valid x.com or twitter.com status URL.",
  ].filter((issue): issue is string => Boolean(issue)) : [];
  const basicsValid = basicsIssues.length === 0;
  const portfolioValid = portfolioIssues.length === 0;
  const proofValid = proofIssues.length === 0;

  useEffect(() => {
    if (!successSlug) return;
    setRedirectSeconds(5);
    const countdownTimer = window.setInterval(() => {
      setRedirectSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    const redirectTimer = window.setTimeout(() => {
      window.location.href = `/otfs/${successSlug}`;
    }, 5_000);
    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [successSlug]);

  if (successSlug) {
    const successTarget = `/otfs/${successSlug}`;
    return <div className="pageShell submissionSuccessPage"><section className="emptyState submissionSuccess" role="status" aria-live="polite"><CheckCircle2 size={48} aria-hidden="true" /><h1>OTF created successfully</h1><p>Your proposal is live in the launch competition and can receive votes immediately when fresh prices are available.</p><Callout tone="warning"><strong>Keep your X post public and unchanged until final results are published.</strong> If it becomes invalid, your proposal will be excluded.</Callout><p className="submissionSuccessCountdown">You’ll be redirected to your OTF in {redirectSeconds} {redirectSeconds === 1 ? "second" : "seconds"}.</p><div className="submissionRedirectProgress" role="progressbar" aria-label="Redirecting to your OTF" aria-valuemin={0} aria-valuemax={5} aria-valuenow={5 - redirectSeconds}><span /></div><a className="button buttonPrimary submissionSuccessButton" href={successTarget}><span>View your OTF</span><ArrowRight size={15} /></a></section></div>;
  }

  if (!eligibility.eligible) return <div className="wizardLayout"><SectionCard className="eligibilityBlocked"><ShieldAlert size={28} aria-hidden="true" /><h2>Eligible X account required</h2><p>Creating an OTF requires a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers. Please connect an eligible account.</p><EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/submit" autoOpen>{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></SectionCard><aside><SectionCard className="sideNote"><strong>Proposal requirements</strong><ul><li>Use a verified, public X account.</li><li>Have at least {eligibility.minFollowers.toLocaleString()} followers.</li><li>Use an account that is at least {eligibility.minAccountAgeDays} days old.</li></ul></SectionCard></aside></div>;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  }

  async function postSubmission() {
    if (challenge && !draftId) {
      setMessage("This submission session is out of date. Start again to prepare a new X post.");
      return;
    }
    if (challenge && !validPostUrl) {
      setMessage("Paste a valid public x.com or twitter.com status URL before submitting.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setProfileRecovery(false);
    const xPostWindow = challenge ? null : window.open("", "_blank");
    if (xPostWindow) xPostWindow.opener = null;
    try {
      if (challenge && draftId) {
        const outcome = await requestWithChallengeReconciliation(
          () => fetch(`/api/submissions/${draftId}/publish`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ challengeId: challenge.challengeId, postUrl }),
          }),
          challenge.challengeId,
          fetch,
          (data) => typeof data === "object" && data !== null && typeof (data as { slug?: unknown }).slug === "string",
        );
        if (outcome.kind === "status") {
          if (outcome.status.status === "succeeded") {
            if (outcome.status.action === "submission") {
              setSuccessSlug(outcome.status.slug);
              return;
            }
            setProfileRecovery(true);
            setMessage("We couldn’t match the completed verification to this proposal. Don’t submit it again; check My profile for the saved result.");
            return;
          }
          if (outcome.status.status === "ready") {
            setMessage("The response was interrupted before confirmation, but this verification is still ready. It is safe to submit the same X post again.");
            return;
          }
          setChallenge(null);
          setPostUrl("");
          setTurnstileToken("");
          setTurnstileResetKey((current) => current + 1);
          setMessage("The response was interrupted and the verification code has expired. Prepare a new X post to continue with this saved draft.");
          return;
        }
        if (outcome.kind === "unknown") {
          setProfileRecovery(true);
          setMessage("We couldn’t confirm whether your proposal went live. Don’t submit it again yet; check My profile for the proposal or its saved draft.");
          return;
        }
        const verifyJson = outcome.body as { data?: { slug?: string }; error?: { code?: string } };
        if (!outcome.response.ok) {
          if (verifyJson.error?.code === "CHALLENGE_EXPIRED") {
            setChallenge(null);
            setPostUrl("");
            setTurnstileToken("");
            setTurnstileResetKey((current) => current + 1);
          }
          setMessage(friendlyError(verifyJson.error?.code, "The X post could not be verified"));
          return;
        }
        setSuccessSlug(verifyJson.data!.slug!);
        return;
      }

      const existingDraftId = draftId;
      let draftResponse: Response;
      let draftJson: { data?: { id?: string }; error?: { code?: string } };
      try {
        draftResponse = await fetch("/api/submissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftId: existingDraftId,
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
        draftJson = await draftResponse.json();
        if (draftResponse.ok && typeof draftJson.data?.id !== "string") throw new Error("UNREADABLE_RESPONSE");
      } catch {
        xPostWindow?.close();
        if (existingDraftId) {
          setMessage("We couldn’t confirm whether your saved draft was updated. It remains available in My profile; try again before publishing.");
        } else {
          setProfileRecovery(true);
          setMessage("We couldn’t confirm whether your draft was saved. Don’t create another yet; check My profile, where any saved draft will appear.");
        }
        return;
      }
      if (!draftResponse.ok) {
        xPostWindow?.close();
        setMessage(friendlyError(draftJson.error?.code, "Draft could not be saved"));
        return;
      }

      const currentDraftId = draftJson.data!.id!;
      setDraftId(currentDraftId);
      try {
        const publishResponse = await fetch(`/api/submissions/${currentDraftId}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason, turnstileToken }),
        });
        const publishJson = await publishResponse.json() as { data?: Challenge; error?: { code?: string } };
        if (!publishResponse.ok) {
          xPostWindow?.close();
          setTurnstileResetKey((current) => current + 1);
          setMessage(friendlyError(publishJson.error?.code, "The X post could not be prepared"));
          return;
        }
        if (!publishJson.data?.challengeId || !publishJson.data.intentUrl) throw new Error("UNREADABLE_RESPONSE");
        setChallenge(publishJson.data);
        if (xPostWindow) xPostWindow.location.href = publishJson.data.intentUrl;
      } catch {
        xPostWindow?.close();
        setTurnstileResetKey((current) => current + 1);
        setMessage("Your draft is saved, but the X post could not be prepared. Complete the verification check and try preparing the post again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return <div className="wizardLayout"><SectionCard className="wizardCard">
    <div className="progressSteps">{["Basics", "Portfolio", "Review", "X post"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="wizardBody">
      {preview && <Callout tone="warning">Preview data is active because the launch database is not configured. The complete interface is available, but proposals will not be saved.</Callout>}
      {initialDraft && <Callout><strong>Draft resumed.</strong> This is the same saved draft. It expires {new Date(initialDraft.draftExpiresAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</Callout>}
      {atProposalLimit && <Callout tone="warning"><strong>Proposal limit reached.</strong> You have {confirmedProposalCount} of {proposalLimit} confirmed proposals. Delete a confirmed proposal before confirming another.</Callout>}
      {step === 1 && <div className="formStack"><label className="formField"><span>OTF name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI Infrastructure OTF" maxLength={80} aria-invalid={!nameValid} aria-describedby={basicsIssues.length ? "basics-validation" : undefined} /><small>Must end in “OTF”.</small></label><label className="formField"><span>Ticker</span><input value={ticker} onChange={(event) => setTicker(normalizeTickerInput(event.target.value))} placeholder="AIX" maxLength={16} aria-invalid={!tickerValid} aria-describedby={basicsIssues.length ? "basics-validation" : undefined} /></label><label className="formField"><span>Investment thesis</span><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="Explain what this portfolio owns, why it belongs together, and the long-term case…" rows={7} aria-invalid={!thesisValid} aria-describedby={basicsIssues.length ? "basics-validation" : undefined} /><small className={`thesisCounter${thesisBytes > 2048 ? " invalid" : ""}`} aria-live="polite">{thesisBytes.toLocaleString()} / 2,048 bytes maximum</small></label><ValidationIssues id="basics-validation" title={`${basicsIssues.length} required item${basicsIssues.length === 1 ? "" : "s"} remaining`} issues={basicsIssues} /></div>}
      {step === 2 && <div className="formStack">
        {verifiedAssets.length === 0 && <Callout>No verified assets are available yet. Search for a Robinhood Chain contract address; the server will validate its 18-decimal ERC-20 and qualifying Uniswap V3 market.</Callout>}
        <div>
          <div className="allocationTotal"><span>Portfolio allocation · {rows.length} assets <small>({competition.rules.minAssets} minimum)</small></span><strong className={total === portfolioWeightPercent && allWeightsMeetMinimum ? "valid" : ""}>{total}%</strong></div>
          <p className="assetDirectoryPrompt">Choose a registry asset; verified assets keep their saved price source, while an unverified asset’s active pool is filled automatically. If an asset is not listed, enter its contract and pool address. The Add token action stays locked until every observed requirement passes. Allocate at least {minimumWeightPercent}% to every asset.</p>
        </div>
        <div className="allocationRows">
          <div className={`allocationColumnHeaders${rows.length > 2 ? " removable" : ""}`}><span>Assets</span><span>Weight · {minimumWeightPercent}% min</span>{rows.length > 2 && <span aria-hidden="true" />}</div>
          {rows.map((row, index) => {
            const weightBelowMinimum = Number(row.weight || 0) < minimumWeightPercent;
            return <div className={`allocationInput${rows.length > 2 ? " removable" : ""}`} key={index}><AssetMarketPicker assets={assets} assetId={row.assetId} assetMetadata={row.assetMetadata} pricingConfig={row.pricingConfig} label={`Asset ${index + 1}`} onChange={(assetId, assetMetadata, pricingConfig) => updateRow(index, { assetId, assetMetadata, pricingConfig })} /><label className="formField weightField"><span className="srOnly">Asset {index + 1} weight · {minimumWeightPercent}% minimum</span><div><input aria-label={`Asset ${index + 1} weight percentage`} aria-invalid={weightBelowMinimum} aria-describedby={portfolioIssues.length ? "portfolio-validation" : undefined} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={row.weight} onChange={(event) => updateRow(index, { weight: normalizeWholeNumberInput(event.target.value, 99) })} /><span>%</span></div></label>{rows.length > 2 && <button className="removeButton" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove asset ${index + 1}`}><Trash2 size={16} /></button>}</div>;
          })}
        </div>
        <ValidationIssues id="portfolio-validation" title="Portfolio needs attention" issues={portfolioIssues} />
        <Callout tone="positive"><strong>Verified OTFs compete for a performance XP pool that is 100% larger: 3.5M versus 1.75M.</strong> Individual awards depend on relative score.</Callout>
        <Button variant="secondary" onClick={() => setRows((current) => { const asset = verifiedAssets.find((candidate) => !current.some((row) => row.assetId === candidate.id)); return [...current, initialRow(asset, String(minimumWeightPercent))]; })}><Plus size={15} /> Add another asset</Button>
      </div>}
      {step === 3 && <div className="reviewBlock">{verified && <div className="reviewBoost"><StatusBadge tone="positive">3.5M performance pool</StatusBadge><small>100% larger than the 1.75M standard pool; individual awards depend on relative score.</small></div>}<div><span>Name</span><strong>{name}</strong></div><div><span>Ticker</span><strong>${ticker}</strong></div><div><span>Thesis</span><p>{thesis}</p></div><div><span>Portfolio</span><ul>{rows.map((row, index) => { const asset = assets.find((candidate) => candidate.id === row.assetId); const metadata = asset ?? row.assetMetadata; return <li key={`${rowIdentities[index]}:${index}`}><span title={metadata?.contractAddress}>{metadata?.symbol} · {metadata?.contractAddress ? shortAddress(metadata.contractAddress) : ""}{row.pricingConfig ? ` · ${pricingConfigSummary(row.pricingConfig)}` : ""}</span><strong>{row.weight}%</strong></li>; })}</ul></div></div>}
      {step === 4 && <div className="proofFlow">{!challenge && <label className="formField"><span>Your context <small>(optional)</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this OTF deserves to launch…" rows={3} maxLength={120} /><small>{reason.length} / 120 characters</small></label>}<div className="xPostPreview"><div><span>{challenge ? "Ready to publish" : "Post preview"}</span><Send size={14} /></div><p>{challenge?.postText ?? postText}</p></div><Callout tone="warning"><strong>Publish the prepared text exactly as shown.</strong> Keep the post public and unchanged until final results are published. If it becomes invalid, your proposal will be excluded.</Callout>{!challenge && <Turnstile siteKey={turnstileSiteKey} action="submit_otf" resetKey={turnstileResetKey} onToken={setTurnstileToken} />}{(challenge || !turnstileSiteKey || turnstileToken) && <div className="postAction">{challenge ? <a className="button buttonPrimary" href={challenge.intentUrl} target="_blank" rel="noreferrer">Open X and post <ExternalLink size={14} /></a> : <Button onClick={postSubmission} disabled={busy || preview}>{busy ? "Opening X…" : "Open X and post"} <ExternalLink size={14} /></Button>}<p className="postAssurance">We never post anything on your behalf.</p></div>}<label className="formField"><span>X post URL</span><input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" disabled={!challenge || busy} aria-invalid={Boolean(challenge) && !validPostUrl} aria-describedby={proofIssues.length ? "proof-validation" : undefined} /><small>{challenge ? validPostUrl ? "URL format looks good. We’ll verify the post, author, and exact prepared text when you submit." : "Paste the public X post URL containing the exact prepared text." : "Open X and publish the prepared post first; this field will then be ready."}</small></label><ValidationIssues id="proof-validation" title="X post needs attention" issues={proofIssues} /></div>}
      {message && <p className="formMessage" role="status">{message}{profileRecovery && <> <a className="inlineLink" href="/me">Open My profile</a>.</>}</p>}
    </div>
    <div className="wizardFooter"><Button variant="secondary" onClick={() => challenge ? setChallenge(null) : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || busy || profileRecovery}>{challenge ? "Start again" : "Back"}</Button>{step < 4 ? <Button onClick={() => setStep((current) => current + 1)} disabled={step === 1 ? !basicsValid : step === 2 ? !portfolioValid : false}>Continue</Button> : <Button onClick={postSubmission} disabled={busy || preview || !challenge || !proofValid || profileRecovery}>{busy ? "Submitting…" : "Submit OTF"}</Button>}</div>
  </SectionCard><aside><SectionCard className="sideNote"><strong>Before you create an OTF</strong><ul><li>Use a verified, public X account with at least {eligibility.minFollowers.toLocaleString()} followers.</li><li>You have {confirmedProposalCount} of {proposalLimit ?? "unlimited"} confirmed proposals in this competition.</li><li>Choose at least {competition.rules.minAssets} 18-decimal assets.</li><li>Allocate at least {minimumWeightPercent}% to every asset.</li><li>Verified assets already include an approved saved price source.</li><li>Unlisted assets require a canonical Uniswap V3 pool plus passing liquidity, verified market-cap, age, GT, honeypot, and locked-liquidity evidence.</li><li>Weights must total exactly {competition.rules.portfolioWeightBps / 100}%.</li><li>You can delete a submission while submissions are open. Votes already cast stay spent but become ineligible for XP.</li></ul></SectionCard></aside></div>;
}
