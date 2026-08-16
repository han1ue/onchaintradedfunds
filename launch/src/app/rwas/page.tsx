import { ExternalLink } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { pricingConfigAddresses, pricingConfigLabel } from "@/lib/pricing-config";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function priceSourceLabel(source: "robinhood-bid" | "coinbase-eth-usd-bid" | "coingecko-usd") {
  if (source === "coingecko-usd") return "CoinGecko USD price";
  return source === "coinbase-eth-usd-bid" ? "Coinbase ETH-USD bid" : "Robinhood bid";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatCheckpointTime(value: string) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const metadata = { title: "Asset metadata" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length === 0 && !process.env.DATABASE_URL;

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Asset metadata and pricing</h1>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> metadata entries {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      <Callout>These records prefill asset names and exact pricing configurations for convenience. They do not approve assets or override the pricing configuration supplied and validated onchain.</Callout>
      {assets.length === 0 ? <Callout tone="danger">No asset metadata has been added yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Quality and price</span><span>Token contract</span><span>Known pricing configurations</span></div>
        {assets.map((asset) => { const market = asset.markets[0]; const config = asset.pricingConfigs.find((candidate) => candidate.active); return <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small><small>{asset.network}</small></div></div>
          <div className="rwaDirectoryPrice" data-label="Quality and price"><div>
            <StatusBadge tone={asset.quality === "high" ? "positive" : "neutral"}>{asset.quality === "high" ? "High quality" : "Normal quality"}</StatusBadge>
            {asset.latestPriceUsd !== null ? <strong>{formatUsd(asset.latestPriceUsd)}</strong> : <strong>—</strong>}
            {asset.latestPriceAt
              ? <small><time dateTime={asset.latestPriceAt}>{formatCheckpointTime(asset.latestPriceAt)}</time> · {priceSourceLabel(asset.priceSource)}</small>
              : <small>No provider price captured</small>}
            {market?.evidenceReasons?.length ? <small title={market.evidenceReasons.join("; ")}>Market evidence · {market.evidenceStatus}: {market.evidenceReasons[0]}</small> : null}
          </div></div>
          {asset.contractAddress === "N/A"
            ? <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">N/A</span>
            : <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${asset.contractAddress}`} target="_blank" rel="noreferrer" title={asset.contractAddress} aria-label={`View ${asset.symbol} token contract on Robinhood Chain explorer`}>
              <span>{shortAddress(asset.contractAddress)}</span><ExternalLink size={13} aria-hidden="true" />
            </a>}
          {config ? (() => { const addresses = pricingConfigAddresses(config); return <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${addresses.primaryAddress}`} target="_blank" rel="noreferrer" title={`${addresses.primaryAddress}${addresses.secondaryAddress ? ` · ${addresses.secondaryAddress}` : ""}`}><span>{pricingConfigLabel(config)} · {shortAddress(addresses.primaryAddress)}{addresses.secondaryAddress ? ` + ${shortAddress(addresses.secondaryAddress)}` : ""}</span><ExternalLink size={13} aria-hidden="true" /></a>; })() : market ? <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${market.poolAddress}`} target="_blank" rel="noreferrer" title={market.poolAddress}><span>Legacy V3 metadata · {shortAddress(market.poolAddress)}</span><ExternalLink size={13} aria-hidden="true" /></a> : <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">Supply an exact configuration</span>}
        </div>; })}
      </>}
    </SectionCard>
  </div>;
}
