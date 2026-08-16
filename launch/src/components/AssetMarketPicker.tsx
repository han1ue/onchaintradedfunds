"use client";

import { Check, ChevronDown, CircleAlert, Search } from "lucide-react";
import { useState } from "react";
import {
  EVM_ADDRESS_PATTERN,
  PRICING_SOURCE_OPTIONS,
  configForSource,
  emptyPricingConfig,
  preferredPricingConfig,
  pricingConfigComplete,
  type PricingSource,
} from "@/lib/pricing-config";
import { normalizeTickerInput } from "@/lib/ticker";
import type { EligibleAsset, PricingConfig, ProposalAssetMetadata } from "@/lib/types";
import { Button, StatusBadge } from "./ui";

type Props = {
  assets: EligibleAsset[];
  assetId: string;
  assetMetadata: ProposalAssetMetadata | null;
  pricingConfig: PricingConfig | null;
  label: string;
  onChange: (assetId: string, assetMetadata: ProposalAssetMetadata | null, pricingConfig: PricingConfig) => void;
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function PricingFields({ config, onChange, prefix }: {
  config: PricingConfig;
  onChange: (config: PricingConfig) => void;
  prefix: string;
}) {
  if (config.source === "chainlink-direct") return <label>
    <span>ASSET/USD feed</span>
    <input aria-label={`${prefix} ASSET/USD feed`} value={config.feedAddress} onChange={(event) => onChange({ ...config, feedAddress: event.target.value })} placeholder="0x…" />
  </label>;
  if (config.source === "chainlink-weth") return <>
    <label>
      <span>ASSET/WETH feed</span>
      <input aria-label={`${prefix} ASSET/WETH feed`} value={config.assetWethFeedAddress} onChange={(event) => onChange({ ...config, assetWethFeedAddress: event.target.value })} placeholder="0x…" />
    </label>
    <label>
      <span>WETH/USD feed</span>
      <input aria-label={`${prefix} WETH/USD feed`} value={config.wethUsdFeedAddress} onChange={(event) => onChange({ ...config, wethUsdFeedAddress: event.target.value })} placeholder="0x…" />
    </label>
  </>;
  return <label>
    <span>Uniswap V3 asset/WETH or asset/USDG pool</span>
    <input aria-label={`${prefix} Uniswap V3 pool`} value={config.poolAddress} onChange={(event) => onChange({ ...config, poolAddress: event.target.value })} placeholder="0x…" />
  </label>;
}

export function AssetMarketPicker({ assets, assetId, assetMetadata, pricingConfig, label, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [assetAddress, setAssetAddress] = useState("");
  const [manualConfig, setManualConfig] = useState<PricingConfig>(emptyPricingConfig("uniswap-v3"));
  const selected = assets.find((asset) => asset.id === assetId) ?? null;
  const selectedMetadata = selected ? null : assetMetadata;
  const selectedSymbol = selected?.symbol ?? selectedMetadata?.symbol;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = assets.filter((asset) => !normalizedQuery
    || asset.name.toLowerCase().includes(normalizedQuery)
    || asset.symbol.toLowerCase().includes(normalizedQuery)
    || asset.contractAddress.toLowerCase() === normalizedQuery);

  function choose(asset: EligibleAsset) {
    const preferred = preferredPricingConfig(asset.pricingConfigs) ?? emptyPricingConfig("uniswap-v3");
    onChange(asset.id, null, preferred);
    setOpen(false);
    setQuery("");
  }

  function selectSource(source: PricingSource) {
    if (!selected && !selectedMetadata) return;
    onChange(
      selected?.id ?? "",
      selectedMetadata,
      selected ? configForSource(selected.pricingConfigs, source) : emptyPricingConfig(source),
    );
  }

  function useManualAsset() {
    const metadata: ProposalAssetMetadata = {
      network: "robinhood-mainnet",
      chainId: 4663,
      contractAddress: assetAddress.trim().toLowerCase(),
      decimals: 18,
      symbol: normalizeTickerInput(assetSymbol),
      name: assetName.trim(),
    };
    onChange("", metadata, manualConfig);
    setOpen(false);
    setManual(false);
    setQuery("");
  }

  return <div className="assetMarketPicker">
    <span className="assetPickerLabel">{label}</span>
    <button className="assetPickerTrigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      {selected || selectedMetadata ? <>
        <span className="assetPickerIdentity"><strong>{selectedSymbol}</strong><small>{selected?.name ?? selectedMetadata?.name} · {shortAddress(selected?.contractAddress ?? selectedMetadata?.contractAddress ?? "")}</small></span>
        <StatusBadge tone={selected?.quality === "high" ? "positive" : "neutral"}>
          {selected?.quality === "high" ? "Verified" : "Non-verified"}
        </StatusBadge>
      </> : <span className="assetPickerPlaceholder">Search by name, symbol, or contract</span>}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="assetPickerMenu">
      <label className="assetPickerSearch"><Search size={15} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="AAPL, token name, or 0x…" /></label>
      <div className="assetPickerResults">
        {filtered.map((asset) => <button key={asset.id} type="button" onClick={() => choose(asset)}>
          <span className="assetPickerIdentity"><strong>{asset.symbol} <small>{asset.name}</small></strong><code>{asset.network} · {asset.contractAddress}</code></span>
          <span className="assetPickerOptionStatus">
            <StatusBadge tone={asset.quality === "high" ? "positive" : "neutral"}>{asset.quality === "high" ? "High" : "Normal"}</StatusBadge>
            {asset.id === assetId && <Check size={15} aria-hidden="true" />}
          </span>
        </button>)}
        {filtered.length === 0 && <div className="assetPickerEmpty"><strong>No metadata entry found</strong><p>The directory is optional. Enter the token&apos;s 18-decimal metadata and exact pricing route to use it in this proposal now.</p><Button variant="secondary" onClick={() => setManual(true)}>Use an unlisted token</Button></div>}
      </div>
      {manual && <div className="manualMarketRequest">
        <label><span>Token name</span><input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Token name" maxLength={80} /></label>
        <label><span>Token symbol</span><input value={assetSymbol} onChange={(event) => setAssetSymbol(normalizeTickerInput(event.target.value))} placeholder="TOKEN" maxLength={16} /></label>
        <label><span>Token contract · Robinhood Mainnet</span><input value={assetAddress} onChange={(event) => setAssetAddress(event.target.value)} placeholder="0x…" /></label>
        <label><span>Token decimals</span><input value="18" readOnly aria-readonly="true" /></label>
        <label><span>Pricing route</span><select value={manualConfig.source} onChange={(event) => setManualConfig(emptyPricingConfig(event.target.value as PricingSource))}>{PRICING_SOURCE_OPTIONS.map((option) => <option key={option.source} value={option.source}>{option.label}</option>)}</select></label>
        <PricingFields config={manualConfig} onChange={setManualConfig} prefix="Metadata request" />
        <Button onClick={useManualAsset} disabled={!assetName.trim() || !normalizeTickerInput(assetSymbol) || !EVM_ADDRESS_PATTERN.test(assetAddress) || !pricingConfigComplete(manualConfig)}>Use token in proposal</Button>
      </div>}
    </div>}
    {(selected || selectedMetadata) && pricingConfig && <div className="selectedMarketEvidence">
      <CircleAlert size={14} aria-hidden="true" />
      <div><strong>Exact pricing configuration</strong><span>This configuration is pinned for the OTF. It never falls back to a different source automatically.</span></div>
      <div className="pricingConfigFields">
        <label><span>Pricing route</span><select aria-label={`${selectedSymbol} pricing route`} value={pricingConfig.source} onChange={(event) => selectSource(event.target.value as PricingSource)}>{PRICING_SOURCE_OPTIONS.map((option) => <option key={option.source} value={option.source}>{option.label}</option>)}</select></label>
        <PricingFields config={pricingConfig} onChange={(config) => onChange(selected?.id ?? "", selectedMetadata, config)} prefix={selectedSymbol ?? "Token"} />
      </div>
      <code>{pricingConfigComplete(pricingConfig) ? "Exact addresses ready for onchain validation" : "Enter every required 0x address"}</code>
    </div>}
  </div>;
}
