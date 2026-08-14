import { Callout, SectionCard, StatusBadge } from "@/components/ui";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export const metadata = { title: "Supported RWAs" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length === 0 && !process.env.DATABASE_URL;

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Supported RWAs</h1>
        <p>Assets supported for launch-competition portfolios. Token contracts are sourced from Robinhood Chain.</p>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> supported {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      {assets.length === 0 ? <Callout tone="danger">No supported RWAs have been added yet.</Callout> : <>
        <div className="rwaDirectoryHeading"><span>Asset</span><span>Token contract</span></div>
        {assets.map((asset) => <div className="rwaDirectoryRow" key={asset.id}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div>
          <span className="rwaDirectoryAddress" title={asset.contractAddress}>{shortAddress(asset.contractAddress)}</span>
        </div>)}
      </>}
    </SectionCard>
  </div>;
}
