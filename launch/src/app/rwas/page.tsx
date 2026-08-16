import { ExternalLink } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function priceSourceLabel(source: "robinhood-bid" | "coinbase-eth-usd-bid") {
  return source === "coinbase-eth-usd-bid" ? "Coinbase ETH-USD bid" : "Robinhood bid";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatCheckpointTime(value: string) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const metadata = { title: "Supported assets" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length === 0 && !process.env.DATABASE_URL;

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Supported assets</h1>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> supported {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      {assets.length === 0 ? <Callout tone="danger">No supported assets have been added yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Price checkpoint</span><span>Token contract</span></div>
        {assets.map((asset) => <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div>
          <div className="rwaDirectoryPrice" data-label="Price checkpoint"><div>
            {asset.latestPriceUsd !== null ? <strong>{formatUsd(asset.latestPriceUsd)}</strong> : <strong>—</strong>}
            {asset.latestPriceAt
              ? <small><time dateTime={asset.latestPriceAt}>{formatCheckpointTime(asset.latestPriceAt)}</time> · {priceSourceLabel(asset.priceSource)}</small>
              : <small>No checkpoint captured</small>}
          </div></div>
          {asset.contractAddress === "N/A"
            ? <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">N/A</span>
            : <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${asset.contractAddress}`} target="_blank" rel="noreferrer" title={asset.contractAddress} aria-label={`View ${asset.symbol} token contract on Robinhood Chain explorer`}>
              <span>{shortAddress(asset.contractAddress)}</span><ExternalLink size={13} aria-hidden="true" />
            </a>}
        </div>)}
      </>}
    </SectionCard>
  </div>;
}
