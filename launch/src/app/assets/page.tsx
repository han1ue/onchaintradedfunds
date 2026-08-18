import { ExternalLink, Info } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { shortAddress } from "@/lib/format-address";
import { getEligibleAssets, getLatestScoringCheckpointAt } from "@/server/data";

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatCheckpointTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function priceSourceLabel(source: "robinhood-bid" | "coinbase-eth-usd-bid" | "coingecko-usd") {
  if (source === "coingecko-usd") return "CoinGecko API";
  if (source === "coinbase-eth-usd-bid") return "Coinbase API";
  return "Robinhood API";
}

export const metadata = { title: "Verified assets" };

export default async function AssetsPage() {
  const [assets, latestScoringCheckpointAt] = await Promise.all([
    getEligibleAssets(),
    getLatestScoringCheckpointAt(),
  ]);
  const preview = assets.length === 0 && !process.env.DATABASE_URL;
  const latestPriceTooltip = latestScoringCheckpointAt
    ? `Latest scoring checkpoint: ${formatCheckpointTime(latestScoringCheckpointAt)}`
    : "No saved price checkpoint yet";

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Verified assets</h1>
        <p>These assets have been verified and approved by the OTF team. OTFs composed exclusively of verified assets are eligible for XP.</p>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> verified assets {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      {assets.length === 0 ? <Callout tone="danger">No verified assets have been added yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Latest price <span className="rwaDirectoryInfo" role="img" tabIndex={0} title={latestPriceTooltip} aria-label={latestPriceTooltip}><Info size={12} aria-hidden="true" /></span></span><span>Token contract</span></div>
        {assets.map((asset) => <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div>
          <div className="rwaDirectoryPrice" data-label="Latest price">
            {asset.latestPriceUsd !== null ? <strong>{formatUsd(asset.latestPriceUsd)}</strong> : <strong>—</strong>}
            {asset.latestPriceAt
              ? <small>{priceSourceLabel(asset.priceSource)}</small>
              : <small>Awaiting first checkpoint</small>}
          </div>
          {asset.contractAddress === "N/A"
            ? <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">N/A</span>
            : <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${asset.contractAddress}`} target="_blank" rel="noreferrer" title={asset.contractAddress} aria-label={`View ${asset.symbol} token contract on Robinhood Chain explorer`}>
              <span>{shortAddress(asset.contractAddress)}</span><ExternalLink size={13} aria-hidden="true" />
            </a>}
        </div>)}
        <Callout tone="warning"><strong>Prices are saved checkpoints, not live quotes.</strong> The 30-minute job stores the latest available provider price in the OTF database.</Callout>
      </>}
    </SectionCard>
  </div>;
}
