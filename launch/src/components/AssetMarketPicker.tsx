"use client";

import { Check, ChevronDown, CircleAlert, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { EligibleAsset } from "@/lib/types";
import { evaluateCompetitionPoolAge } from "@/lib/experimental-eligibility";
import { Button, StatusBadge } from "./ui";

type Props = {
  assets: EligibleAsset[];
  assetId: string;
  marketId: string | null;
  label: string;
  competitionStartsAt: string;
  onChange: (assetId: string, marketId: string | null) => void;
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function AssetMarketPicker({ assets, assetId, marketId, label, competitionStartsAt, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [assetAddress, setAssetAddress] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "busy" | "queued" | "error">("idle");
  const selected = assets.find((asset) => asset.id === assetId);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => assets.filter((asset) => !normalizedQuery
    || asset.name.toLowerCase().includes(normalizedQuery)
    || asset.symbol.toLowerCase().includes(normalizedQuery)
    || asset.contractAddress.toLowerCase() === normalizedQuery), [assets, normalizedQuery]);
  const selectedMarket = selected?.markets.find((market) => market.id === marketId) ?? null;
  const poolAgeStatus = (market: EligibleAsset["markets"][number]) => evaluateCompetitionPoolAge(
    market.poolCreatedAt ? new Date(market.poolCreatedAt) : null,
    new Date(competitionStartsAt),
  );
  const isLaunchReady = (market: EligibleAsset["markets"][number]) => (
    market.active && market.twapOneHourReady && poolAgeStatus(market).status === "Pass"
  );
  const selectedPoolAge = selectedMarket ? poolAgeStatus(selectedMarket) : null;

  function choose(asset: EligibleAsset) {
    if (asset.qualityStatus === "blocked") return;
    const market = asset.markets.find(isLaunchReady)
      ?? asset.markets.find((candidate) => candidate.active && candidate.twapOneHourReady)
      ?? asset.markets.find((candidate) => candidate.active)
      ?? null;
    onChange(asset.id, market?.id ?? null);
    setOpen(false);
    setQuery("");
  }

  async function queueManualMarket() {
    setRequestState("busy");
    const response = await fetch("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: "robinhood-mainnet", assetAddress, poolAddress }),
    });
    setRequestState(response.ok ? "queued" : "error");
  }

  return <div className="assetMarketPicker">
    <span className="assetPickerLabel">{label}</span>
    <button className="assetPickerTrigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      {selected ? <>
        <span className="assetPickerIdentity"><strong>{selected.symbol}</strong><small>{selected.name} · {shortAddress(selected.contractAddress)}</small></span>
        <StatusBadge tone={selected.qualityStatus === "qualified" ? "positive" : selected.qualityStatus === "open" ? "warning" : "danger"}>
          {selected.qualityStatus === "qualified" ? "Protocol-qualified asset" : selected.qualityStatus}
        </StatusBadge>
      </> : <span className="assetPickerPlaceholder">Search by name, symbol, or contract</span>}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="assetPickerMenu">
      <label className="assetPickerSearch"><Search size={15} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="AAPL, token name, or 0x…" /></label>
      <div className="assetPickerResults">
        {filtered.map((asset) => <button key={asset.id} type="button" disabled={asset.qualityStatus === "blocked"} onClick={() => choose(asset)}>
          <span className="assetPickerIdentity"><strong>{asset.symbol} <small>{asset.name}</small></strong><code>{asset.network} · {asset.contractAddress}</code></span>
          <span className="assetPickerOptionStatus">
            <StatusBadge tone={asset.qualityStatus === "qualified" ? "positive" : asset.qualityStatus === "open" ? "warning" : "danger"}>{asset.qualityStatus}</StatusBadge>
            {asset.id === assetId && <Check size={15} aria-hidden="true" />}
          </span>
        </button>)}
        {filtered.length === 0 && <div className="assetPickerEmpty"><strong>No registered token found</strong><p>Contract address and network are the canonical identity. Add its exact V3 asset/WETH pool for onchain verification.</p><Button variant="secondary" onClick={() => setManual(true)}>Enter token and pool</Button></div>}
      </div>
      {manual && <div className="manualMarketRequest">
        <label><span>Token contract · Robinhood Mainnet</span><input value={assetAddress} onChange={(event) => setAssetAddress(event.target.value)} placeholder="0x…" /></label>
        <label><span>Uniswap V3 asset/WETH pool</span><input value={poolAddress} onChange={(event) => setPoolAddress(event.target.value)} placeholder="0x…" /></label>
        <Button onClick={queueManualMarket} disabled={requestState === "busy" || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress) || !/^0x[0-9a-fA-F]{40}$/.test(poolAddress)}>{requestState === "busy" ? "Checking…" : "Queue onchain verification"}</Button>
        {requestState === "queued" && <p className="manualMarketState positive">Request queued. It becomes selectable only after registry and one-hour TWAP checks pass.</p>}
        {requestState === "error" && <p className="manualMarketState danger">The request could not be queued. Check both addresses and try again.</p>}
      </div>}
    </div>}
    {selected && selected.qualityStatus === "open" && <div className="selectedMarketEvidence">
      <CircleAlert size={14} aria-hidden="true" />
      <div><strong>Experimental asset</strong><span>Pool-derived prices and token behavior can be manipulated.</span></div>
      {selected.markets.length > 1 && <select aria-label={`${selected.symbol} pinned V3 market`} value={marketId ?? ""} onChange={(event) => onChange(selected.id, event.target.value || null)}>
        {selected.markets.map((market) => <option key={market.id} value={market.id} disabled={!isLaunchReady(market)}>{shortAddress(market.poolAddress)} · {market.feeTier / 10_000}% · {!market.twapOneHourReady ? "TWAP warming up" : poolAgeStatus(market).status === "Pending" ? "pool age pending" : poolAgeStatus(market).status === "Fail" ? "too new for this launch" : "launch-ready"}</option>)}
      </select>}
      {selectedMarket && <code>{selectedMarket.poolAddress} · {!selectedMarket.twapOneHourReady ? "1h TWAP warming up" : selectedPoolAge?.status === "Pending" ? selectedPoolAge.reasons[0] : selectedPoolAge?.status === "Fail" ? "Pool was too new when this launch started" : "1h TWAP and launch-age checks ready"}</code>}
    </div>}
  </div>;
}
