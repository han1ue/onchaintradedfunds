"use client";

import { BadgeCheck, Check, ChevronDown, CircleAlert, CircleCheck, CircleDot, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetMarketRequirement, AssetMarketValidationResponse } from "@/lib/asset-market-validation";
import { errorMessages } from "@/lib/errors";
import { shortAddress } from "@/lib/format-address";
import { EVM_ADDRESS_PATTERN, preferredPricingConfig } from "@/lib/pricing-config";
import { normalizeTickerInput } from "@/lib/ticker";
import type { EligibleAsset, PricingConfig, ProposalAssetMetadata } from "@/lib/types";
import { Button } from "./ui";

type Props = {
  assets: EligibleAsset[];
  assetId: string;
  assetMetadata: ProposalAssetMetadata | null;
  pricingConfig: PricingConfig | null;
  label: string;
  onChange: (assetId: string, assetMetadata: ProposalAssetMetadata | null, pricingConfig: PricingConfig | null) => void;
};

function observedValue(requirement: AssetMarketRequirement) {
  if (requirement.observed === null) return requirement.status === "pending" ? "Pending" : "Unavailable";
  if (typeof requirement.observed === "boolean") return requirement.observed ? "Yes" : "No";
  if (requirement.key === "liquidity-usd" || requirement.key === "verified-market-cap") {
    const number = Number(requirement.observed);
    return Number.isFinite(number) ? `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : String(requirement.observed);
  }
  if (requirement.key === "locked-liquidity") return `${Number(requirement.observed).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return String(requirement.observed);
}

function requirementStatusLabel(status: AssetMarketRequirement["status"]) {
  return status === "pass" ? "Pass" : status === "fail" ? "Fail" : status === "pending" ? "Pending" : "Unavailable";
}

function validationDecision(validation: AssetMarketValidationResponse, approved: boolean) {
  if (approved) return {
    tone: "approved" as const,
    title: "Asset approved",
    detail: "Every ERC-20, pool, and market requirement passed.",
  };
  const failed = validation.requirements.filter((item) => item.status === "fail");
  const waiting = validation.requirements.filter((item) => item.status === "pending" || item.status === "unavailable");
  const details = [
    failed.length ? `Failed: ${failed.map((item) => item.label).join(", ")}.` : "",
    waiting.length ? `Evidence needed: ${waiting.map((item) => item.label).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return {
    tone: failed.length ? "blocked" as const : "waiting" as const,
    title: failed.length ? "Asset not approved" : "Asset not approved yet",
    detail: details || "Every requirement must pass before this token can be added.",
  };
}

function validationRequestError(code: string) {
  if (code === "RATE_LIMITED") return {
    title: "Too many validation requests",
    detail: errorMessages.RATE_LIMITED,
  };
  if (code === "UNAUTHENTICATED" || code === "X_RECONNECT_REQUIRED") return {
    title: "Sign in required",
    detail: code === "X_RECONNECT_REQUIRED" ? errorMessages.X_RECONNECT_REQUIRED : errorMessages.UNAUTHENTICATED,
  };
  if (code === "RATE_LIMIT_UNAVAILABLE" || code === "ASSET_MARKET_VALIDATION_UNAVAILABLE") return {
    title: "Validation temporarily unavailable",
    detail: code === "RATE_LIMIT_UNAVAILABLE" ? errorMessages.RATE_LIMIT_UNAVAILABLE : errorMessages.ASSET_MARKET_VALIDATION_UNAVAILABLE,
  };
  return {
    title: "Validation request failed",
    detail: errorMessages[code] ?? "Nothing was saved. Check both addresses and try again.",
  };
}

export function AssetMarketPicker({ assets, assetId, assetMetadata, pricingConfig, label, onChange }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [assetAddress, setAssetAddress] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [validation, setValidation] = useState<AssetMarketValidationResponse | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [lookupError, setLookupError] = useState<{ title: string; detail: string } | null>(null);
  const selected = assets.find((asset) => asset.id === assetId) ?? null;
  const selectedMetadata = selected ? null : assetMetadata;
  const selectedSymbol = selected?.symbol ?? selectedMetadata?.symbol;
  const normalizedQuery = query.trim().toLowerCase();
  const verifiedAssets = useMemo(() => assets.filter((asset) => asset.quality === "high"), [assets]);
  const filtered = verifiedAssets.filter((asset) => !normalizedQuery
    || asset.name.toLowerCase().includes(normalizedQuery)
    || asset.symbol.toLowerCase().includes(normalizedQuery)
    || asset.contractAddress.toLowerCase() === normalizedQuery);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (manual && !dialog.open) dialog.showModal();
    if (!manual && dialog.open) dialog.close();
  }, [manual]);

  useEffect(() => {
    setValidation(null);
    setLookupError(null);
    if (!manual || !EVM_ADDRESS_PATTERN.test(assetAddress.trim())) {
      setLookupState("idle");
      return;
    }
    const hasPoolAddress = EVM_ADDRESS_PATTERN.test(poolAddress.trim());
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLookupState("loading");
      const query = new URLSearchParams({ assetAddress: assetAddress.trim() });
      if (hasPoolAddress) query.set("poolAddress", poolAddress.trim());
      fetch(`/api/v1/assets/validate?${query.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error?.code ?? "ASSET_MARKET_VALIDATION_UNAVAILABLE");
          return payload.data as AssetMarketValidationResponse;
        })
        .then((result) => {
          setValidation(result);
          setLookupState("idle");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "ASSET_MARKET_VALIDATION_UNAVAILABLE";
          setLookupError(validationRequestError(code));
          setLookupState("error");
        });
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [assetAddress, manual, poolAddress]);

  function choose(asset: EligibleAsset) {
    const configuredPriceSource = asset.quality === "high" ? null : preferredPricingConfig(asset.pricingConfigs);
    onChange(asset.id, null, configuredPriceSource);
    setOpen(false);
    setQuery("");
  }

  function openManualAsset() {
    const queryAddress = EVM_ADDRESS_PATTERN.test(query.trim()) ? query.trim() : "";
    const currentPool = pricingConfig?.source === "uniswap-v3" ? pricingConfig.poolAddress : "";
    setAssetAddress(selectedMetadata?.contractAddress ?? queryAddress);
    setPoolAddress(selectedMetadata ? currentPool : "");
    setOpen(false);
    setManual(true);
  }

  function useManualAsset() {
    const detected = validation?.asset;
    if (!detected || validation?.status !== "pass" || validation.requirements.some((item) => item.status !== "pass")) return;
    const metadata: ProposalAssetMetadata = {
      network: "robinhood-mainnet",
      chainId: 4663,
      contractAddress: detected.address.toLowerCase(),
      decimals: 18,
      symbol: normalizeTickerInput(detected.symbol),
      name: detected.name.trim().slice(0, 80),
    };
    onChange("", metadata, { source: "uniswap-v3", poolAddress: validation.market.poolAddress! });
    setManual(false);
    setQuery("");
    setValidation(null);
  }

  const detected = validation?.asset ?? null;
  const hasValidPoolAddress = EVM_ADDRESS_PATTERN.test(poolAddress.trim());
  const canUseManualAsset = validation?.status === "pass"
    && Boolean(detected && detected.decimals === 18 && normalizeTickerInput(detected.symbol) && detected.name.trim())
    && validation.requirements.every((item) => item.status === "pass");
  const decision = validation ? validationDecision(validation, canUseManualAsset) : null;

  return <div className="assetMarketPicker">
    <button className="assetPickerTrigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${label}: choose asset`}>
      {selected || selectedMetadata ? <>
        <span className="assetPickerIdentity">
          <span className="assetPickerTicker"><strong>{selectedSymbol}</strong>{selected ? <BadgeCheck className="assetPickerVerificationIcon" size={12} aria-label="Verified asset" /> : <CircleAlert className="assetPickerVerificationIcon unverified" size={12} aria-label="Unverified asset" />}</span>
          <small>{selected?.name ?? selectedMetadata?.name} · {shortAddress(selected?.contractAddress ?? selectedMetadata?.contractAddress ?? "")}</small>
        </span>
      </> : <span className="assetPickerPlaceholder">Choose a verified asset</span>}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="assetPickerMenu">
      <label className="assetPickerSearch"><Search size={15} aria-hidden="true" /><span className="srOnly">Search verified assets</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or contract address" /></label>
      <div className="assetPickerResults">
        {selectedMetadata && !normalizedQuery && <button type="button" onClick={openManualAsset}>
          <span className="assetPickerIdentity">
            <span className="assetPickerTicker"><strong>{selectedMetadata.symbol}</strong><CircleAlert className="assetPickerVerificationIcon unverified" size={12} aria-label="Unverified asset" /></span>
            <small>{selectedMetadata.name}</small>
            <code>Edit contract and Uniswap V3 pool</code>
          </span>
        </button>}
        {filtered.map((asset) => <button key={asset.id} type="button" onClick={() => choose(asset)}>
          <span className="assetPickerIdentity">
            <span className="assetPickerTicker"><strong>{asset.symbol}</strong><BadgeCheck className="assetPickerVerificationIcon" size={12} aria-label="Verified asset" /></span>
            <small>{asset.name}</small>
            <code>{asset.network} · {shortAddress(asset.contractAddress)}</code>
          </span>
          <span className="assetPickerOptionStatus">
            {asset.id === assetId && <Check size={15} aria-hidden="true" />}
          </span>
        </button>)}
        {filtered.length === 0 && <div className="assetPickerEmpty"><strong>No verified asset found</strong><p>Add another Robinhood Chain token by contract address. Server-side validation checks its ERC-20, canonical pool, and current market evidence before it can enter the portfolio.</p><Button variant="secondary" onClick={openManualAsset}>{EVM_ADDRESS_PATTERN.test(query.trim()) ? "Continue with this address" : "Add by contract address"}</Button></div>}
      </div>
    </div>}

    <dialog ref={dialogRef} className="assetRequestDialog" onClose={() => setManual(false)} onCancel={() => setManual(false)} aria-labelledby={`${label.replace(/\s+/g, "-").toLowerCase()}-asset-dialog-title`}>
      <div className="assetRequestDialogBody">
        <button className="dialogClose" type="button" onClick={() => setManual(false)} aria-label="Close asset request"><X size={17} /></button>
        <h2 id={`${label.replace(/\s+/g, "-").toLowerCase()}-asset-dialog-title`}>Add an unlisted asset</h2>
        <p>Enter its Robinhood Chain contract and canonical Uniswap V3 pool. The browser never calls CoinGecko and never receives the Demo key.</p>

        <label className="assetRequestField">
          <span>Token contract address</span>
          <input autoFocus value={assetAddress} onChange={(event) => setAssetAddress(event.target.value)} placeholder="0x…" spellCheck="false" />
          {!assetAddress && <small>Robinhood Chain · 18-decimal ERC-20 tokens only</small>}
        </label>

        {lookupState === "loading" && <div className="tokenLookupState" role="status"><span className="tokenLookupPulse" /><div><strong>{hasValidPoolAddress ? "Validating asset and pool" : "Validating token"}</strong><small>{hasValidPoolAddress ? "Checking Robinhood Chain first, then market evidence…" : "Checking token info now; enter a pool address to continue."}</small></div></div>}
        {lookupState === "error" && lookupError && <div className="tokenLookupState danger" role="alert"><CircleAlert size={17} /><div><strong>{lookupError.title}</strong><small>{lookupError.detail}</small></div></div>}
        {detected && <div className={`detectedAsset${detected.decimals === 18 ? "" : " invalid"}`}>
          {detected.decimals === 18 ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          <div><span>{detected.symbol}</span><strong>{detected.name}</strong><small>{detected.decimals} decimals</small></div>
        </div>}
        {detected && detected.decimals !== 18 && <p className="assetRequestError" role="alert">This token cannot be added. OTF constituents must use exactly 18 decimals.</p>}

        <label className="assetRequestField">
          <span>Uniswap V3 pool address</span>
          <input value={poolAddress} onChange={(event) => setPoolAddress(event.target.value)} placeholder="0x…" spellCheck="false" />
          <small>Use the canonical token/WETH or token/USDG Uniswap V3 pool. Every check below must pass.</small>
        </label>

        {validation && decision && <div className={`marketValidationDecision ${decision.tone}`} role={decision.tone === "approved" ? "status" : "alert"} aria-live="polite">
          {decision.tone === "approved" ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
          <div><strong>{decision.title}</strong><small>{decision.detail}</small></div>
        </div>}

        {validation && <div className="poolRequirements" aria-live="polite">
          <strong>Observed market requirements</strong>
          {validation.requirements.map((item) => <div className={`marketRequirement ${item.status}`} key={item.key}>
            <span className="marketRequirementIcon" aria-hidden="true">{item.status === "pass" ? <CircleCheck size={15} /> : item.status === "fail" ? <CircleAlert size={15} /> : <CircleDot size={15} />}</span>
            <div><strong>{item.label}</strong><p>Required: {item.required}</p><small>Observed: {observedValue(item)} · {requirementStatusLabel(item.status)} · {item.source === "robinhood-rpc" ? "Robinhood RPC" : "GeckoTerminal"}</small></div>
          </div>)}
          <small>Provider evidence is read on the server. Pending or unavailable evidence blocks adding the token.</small>
        </div>}

        <div className="assetRequestActions">
          <Button variant="secondary" onClick={() => setManual(false)}>Cancel</Button>
          <Button onClick={useManualAsset} disabled={!canUseManualAsset}>{detected ? `Add ${normalizeTickerInput(detected.symbol)}` : "Add token"}</Button>
        </div>
      </div>
    </dialog>
  </div>;
}
