import { ExternalLink } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function priceSourceLabel(source: "robinhood-bid" | "coinbase-eth-usd-bid" | "uniswap-v3-twap") {
  if (source === "uniswap-v3-twap") return "Onchain Uniswap V3 TWAP";
  return source === "coinbase-eth-usd-bid" ? "Coinbase ETH-USD bid" : "Robinhood bid";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatCheckpointTime(value: string) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const metadata = { title: "Registered assets" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length === 0 && !process.env.DATABASE_URL;

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Registered assets and markets</h1>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> registered {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      {assets.length === 0 ? <Callout tone="danger">No registered assets have been added yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Quality and price</span><span>Token contract</span><span>Registered V3 market</span></div>
        {assets.map((asset) => { const market = asset.markets[0]; return <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small><small>{asset.network}</small></div></div>
          <div className="rwaDirectoryPrice" data-label="Quality and price"><div>
            <StatusBadge tone={asset.qualityStatus === "qualified" ? "positive" : asset.qualityStatus === "open" ? "warning" : "danger"}>{asset.qualityStatus === "qualified" ? "Protocol-qualified asset" : asset.qualityStatus}</StatusBadge>
            {asset.latestPriceUsd !== null ? <strong>{formatUsd(asset.latestPriceUsd)}</strong> : <strong>—</strong>}
            {asset.latestPriceAt
              ? <small><time dateTime={asset.latestPriceAt}>{formatCheckpointTime(asset.latestPriceAt)}</time> · {priceSourceLabel(asset.priceSource)}</small>
              : <small>No checkpoint captured</small>}
            {market?.eligibilityReasons?.length ? <small title={market.eligibilityReasons.join("; ")}>{market.eligibilityStatus}: {market.eligibilityReasons[0]}</small> : null}
          </div></div>
          {asset.contractAddress === "N/A"
            ? <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">N/A</span>
            : <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${asset.contractAddress}`} target="_blank" rel="noreferrer" title={asset.contractAddress} aria-label={`View ${asset.symbol} token contract on Robinhood Chain explorer`}>
              <span>{shortAddress(asset.contractAddress)}</span><ExternalLink size={13} aria-hidden="true" />
            </a>}
          {market ? <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${market.poolAddress}`} target="_blank" rel="noreferrer" title={market.poolAddress}><span>{shortAddress(market.poolAddress)} · {market.feeTier / 10_000}% · {market.twapOneHourReady ? "1h ready" : "warming up"}</span><ExternalLink size={13} aria-hidden="true" /></a> : <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">No registered market</span>}
        </div>; })}
      </>}
    </SectionCard>
  </div>;
}
