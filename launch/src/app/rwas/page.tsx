import { SectionCard, StatusBadge } from "@/components/ui";
import { launchAssets } from "@/lib/launch-assets";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export const metadata = { title: "Supported RWAs" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length > 0 && assets.every((asset) => asset.robinhoodUid.startsWith("preview-"));
  const eligibleBySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Supported RWAs</h1>
        <p>Assets supported for launch-competition portfolios. Token contracts are sourced from Robinhood Chain.</p>
      </div>
      <div className="rwaDirectoryCount"><strong>{launchAssets.length.toLocaleString()}</strong> supported {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      <div className="rwaDirectoryHeading"><span>Asset</span><span>Token contract</span></div>
      {launchAssets.map((catalogAsset) => {
        const asset = eligibleBySymbol.get(catalogAsset.symbol);
        const contractAddress = catalogAsset.contractAddress ?? asset?.contractAddress;
        return <div className="rwaDirectoryRow" key={catalogAsset.symbol}>
          <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{catalogAsset.symbol.slice(0, 3)}</span><div><strong>{catalogAsset.symbol}</strong><small>{catalogAsset.name}</small></div></div>
          <span className="rwaDirectoryAddress" title={contractAddress}>{contractAddress ? shortAddress(contractAddress) : "—"}</span>
        </div>;
      })}
    </SectionCard>
  </div>;
}
