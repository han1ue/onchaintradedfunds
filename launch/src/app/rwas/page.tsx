import { ExternalLink } from "lucide-react";
import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { pricingConfigAddresses, pricingConfigLabel } from "@/lib/pricing-config";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export const metadata = { title: "Verified assets" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length === 0 && !process.env.DATABASE_URL;

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
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Token contract</span><span>Pricing configuration</span></div>
        {assets.map((asset) => { const market = asset.markets[0]; const config = asset.pricingConfigs.find((candidate) => candidate.active); return <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small><small>{asset.network}</small></div></div>
          {asset.contractAddress === "N/A"
            ? <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">N/A</span>
            : <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${asset.contractAddress}`} target="_blank" rel="noreferrer" title={asset.contractAddress} aria-label={`View ${asset.symbol} token contract on Robinhood Chain explorer`}>
              <span>{shortAddress(asset.contractAddress)}</span><ExternalLink size={13} aria-hidden="true" />
            </a>}
          {config ? (() => { const addresses = pricingConfigAddresses(config); return <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${addresses.primaryAddress}`} target="_blank" rel="noreferrer" title={`${addresses.primaryAddress}${addresses.secondaryAddress ? ` · ${addresses.secondaryAddress}` : ""}`}><span>{pricingConfigLabel(config)} · {shortAddress(addresses.primaryAddress)}{addresses.secondaryAddress ? ` + ${shortAddress(addresses.secondaryAddress)}` : ""}</span><ExternalLink size={13} aria-hidden="true" /></a>; })() : market ? <a className="rwaDirectoryAddress" href={`https://robinhoodchain.blockscout.com/address/${market.poolAddress}`} target="_blank" rel="noreferrer" title={market.poolAddress}><span>Legacy V3 metadata · {shortAddress(market.poolAddress)}</span><ExternalLink size={13} aria-hidden="true" /></a> : <span className="rwaDirectoryAddress rwaDirectoryAddressUnavailable">Supply an exact configuration</span>}
        </div>; })}
        <Callout tone="warning"><strong>Verification does not replace onchain validation.</strong> Every proposal must still supply an exact pricing configuration for each asset.</Callout>
      </>}
    </SectionCard>
  </div>;
}
