import { BadgeCheck, ExternalLink, Info } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { shortAddress } from "@/lib/format-address";
import { getAssetRegistry, getLatestScoringCheckpointAt } from "@/server/data";

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

export const metadata = { title: "Asset registry" };

export default async function AssetsPage() {
  const [assets, latestScoringCheckpointAt] = await Promise.all([
    getAssetRegistry(),
    getLatestScoringCheckpointAt(),
  ]);
  const preview = assets.length === 0 && !process.env.DATABASE_URL;
  const latestPriceTooltip = latestScoringCheckpointAt
    ? `Latest scoring checkpoint: ${formatCheckpointTime(latestScoringCheckpointAt)}`
    : "No saved price checkpoint yet";

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Asset registry</h1>
        <p>All assets known to Launch, including their saved performance pricing source. A check identifies verified assets.</p>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> assets {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      {assets.length === 0 ? <Callout tone="danger">No assets have been added to the registry yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Latest price <span className="rwaDirectoryInfo" role="img" tabIndex={0} title={latestPriceTooltip} aria-label={latestPriceTooltip}><Info size={12} aria-hidden="true" /></span></span><span>Token contract</span></div>
        {assets.map((asset) => <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><span className="rwaDirectoryTicker">{asset.verified && <BadgeCheck size={14} aria-label="Verified asset" />}<strong>{asset.symbol}</strong></span><small>{asset.name}</small></div></div>
          <div className="rwaDirectoryPrice" data-label="Latest price">
            {asset.latestPriceUsd !== null ? <strong>{formatUsd(asset.latestPriceUsd)}</strong> : <strong>—</strong>}
            <small>{priceSourceLabel(asset.priceSource)}{asset.latestPriceAt ? "" : " · awaiting first checkpoint"}</small>
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
