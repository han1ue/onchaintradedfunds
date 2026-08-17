"use client";

import { Check, ChevronDown, CircleAlert, CircleCheck, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EVM_ADDRESS_PATTERN, preferredPricingConfig } from "@/lib/pricing-config";
import { normalizeTickerInput } from "@/lib/ticker";
import type { EligibleAsset, PricingConfig, ProposalAssetMetadata } from "@/lib/types";
import { Button, StatusBadge } from "./ui";

type Props = {
  assets: EligibleAsset[];
  assetId: string;
  assetMetadata: ProposalAssetMetadata | null;
  pricingConfig: PricingConfig | null;
  label: string;
  onChange: (assetId: string, assetMetadata: ProposalAssetMetadata | null, pricingConfig: PricingConfig | null) => void;
};

type DetectedMetadata = { address: string; name: string; symbol: string; decimals: number };

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function AssetMarketPicker({ assets, assetId, assetMetadata, pricingConfig, label, onChange }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [assetAddress, setAssetAddress] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [detected, setDetected] = useState<DetectedMetadata | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");
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
    setDetected(null);
    if (!manual || !EVM_ADDRESS_PATTERN.test(assetAddress.trim())) {
      setLookupState("idle");
      return;
    }
    const controller = new AbortController();
    setLookupState("loading");
    fetch(`/api/v1/assets/metadata?address=${encodeURIComponent(assetAddress.trim())}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.code ?? "TOKEN_METADATA_UNAVAILABLE");
        return payload.data as DetectedMetadata;
      })
      .then((metadata) => {
        setDetected(metadata);
        setLookupState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLookupState("error");
      });
    return () => controller.abort();
  }, [assetAddress, manual]);

  function choose(asset: EligibleAsset) {
    const configuredPriceSource = preferredPricingConfig(asset.pricingConfigs);
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
    if (!detected || detected.decimals !== 18) return;
    const metadata: ProposalAssetMetadata = {
      network: "robinhood-mainnet",
      chainId: 4663,
      contractAddress: detected.address.toLowerCase(),
      decimals: 18,
      symbol: normalizeTickerInput(detected.symbol),
      name: detected.name.trim().slice(0, 80),
    };
    onChange("", metadata, { source: "uniswap-v3", poolAddress: poolAddress.trim().toLowerCase() });
    setManual(false);
    setQuery("");
  }

  const canUseManualAsset = detected?.decimals === 18
    && Boolean(normalizeTickerInput(detected.symbol) && detected.name.trim())
    && EVM_ADDRESS_PATTERN.test(poolAddress.trim());

  return <div className="assetMarketPicker">
    <button className="assetPickerTrigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${label}: choose asset`}>
      {selected || selectedMetadata ? <>
        <span className="assetPickerIdentity"><strong>{selectedSymbol}</strong><small>{selected?.name ?? selectedMetadata?.name} · {shortAddress(selected?.contractAddress ?? selectedMetadata?.contractAddress ?? "")}</small></span>
        <StatusBadge tone={selected ? "positive" : "warning"}>{selected ? "Verified" : "Unverified"}</StatusBadge>
      </> : <span className="assetPickerPlaceholder">Choose a verified asset</span>}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="assetPickerMenu">
      <label className="assetPickerSearch"><Search size={15} aria-hidden="true" /><span className="srOnly">Search verified assets</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or contract address" /></label>
      <div className="assetPickerResults">
        {selectedMetadata && !normalizedQuery && <button type="button" onClick={openManualAsset}>
          <span className="assetPickerIdentity"><strong>{selectedMetadata.symbol} <small>{selectedMetadata.name}</small></strong><code>Edit contract and Uniswap V3 pool</code></span>
          <StatusBadge tone="warning">Unverified</StatusBadge>
        </button>}
        {filtered.map((asset) => <button key={asset.id} type="button" onClick={() => choose(asset)}>
          <span className="assetPickerIdentity"><strong>{asset.symbol} <small>{asset.name}</small></strong><code>{asset.network} · {asset.contractAddress}</code></span>
          <span className="assetPickerOptionStatus">
            <StatusBadge tone="positive">Verified</StatusBadge>
            {asset.id === assetId && <Check size={15} aria-hidden="true" />}
          </span>
        </button>)}
        {filtered.length === 0 && <div className="assetPickerEmpty"><strong>No verified asset found</strong><p>Add another Robinhood Chain token by contract address. We&apos;ll read its ticker and name onchain, then ask for a qualifying Uniswap V3 pool.</p><Button variant="secondary" onClick={openManualAsset}>{EVM_ADDRESS_PATTERN.test(query.trim()) ? "Continue with this address" : "Add by contract address"}</Button></div>}
      </div>
    </div>}

    <dialog ref={dialogRef} className="assetRequestDialog" onClose={() => setManual(false)} onCancel={() => setManual(false)} aria-labelledby={`${label.replace(/\s+/g, "-").toLowerCase()}-asset-dialog-title`}>
      <div className="assetRequestDialogBody">
        <button className="dialogClose" type="button" onClick={() => setManual(false)} aria-label="Close asset request"><X size={17} /></button>
        <h2 id={`${label.replace(/\s+/g, "-").toLowerCase()}-asset-dialog-title`}>Add an unlisted asset</h2>
        <p>Enter its Robinhood Chain contract. We&apos;ll read the token identity onchain before you add a pricing pool.</p>

        <label className="assetRequestField">
          <span>Token contract address</span>
          <input autoFocus value={assetAddress} onChange={(event) => setAssetAddress(event.target.value)} placeholder="0x…" spellCheck="false" />
          {!assetAddress && <small>Robinhood Chain · 18-decimal ERC-20 tokens only</small>}
        </label>

        {lookupState === "loading" && <div className="tokenLookupState" role="status"><span className="tokenLookupPulse" /><div><strong>Reading token details</strong><small>Checking the contract on Robinhood Chain…</small></div></div>}
        {lookupState === "error" && <div className="tokenLookupState danger" role="alert"><CircleAlert size={17} /><div><strong>Token details unavailable</strong><small>Check the contract address and try again.</small></div></div>}
        {detected && <div className={`detectedAsset${detected.decimals === 18 ? "" : " invalid"}`}>
          {detected.decimals === 18 ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          <div><span>{detected.symbol}</span><strong>{detected.name}</strong><small>{detected.decimals} decimals</small></div>
        </div>}
        {detected && detected.decimals !== 18 && <p className="assetRequestError" role="alert">This token cannot be added. OTF constituents must use 18 decimals.</p>}

        <label className="assetRequestField">
          <span>Uniswap V3 pool address</span>
          <input value={poolAddress} onChange={(event) => setPoolAddress(event.target.value)} placeholder="0x…" spellCheck="false" />
          <small>Use the token/WETH or token/USDG pool that should provide its TWAP price.</small>
        </label>

        <div className="poolRequirements">
          <strong>Pool requirements before deployment</strong>
          <div><span>Age</span><p>Created at least 7 days before the OTF deploys</p></div>
          <div><span>Liquidity</span><p>At least $10,000 in active liquidity</p></div>
          <div><span>Market cap</span><p>Token above $1,000,000 on CoinMarketCap</p></div>
          <small>These requirements must be met before deployment. The OTF remains unverified because this asset is not in the verified directory.</small>
        </div>

        <div className="assetRequestActions">
          <Button variant="secondary" onClick={() => setManual(false)}>Cancel</Button>
          <Button onClick={useManualAsset} disabled={!canUseManualAsset}>Add unverified asset</Button>
        </div>
      </div>
    </dialog>
  </div>;
}
