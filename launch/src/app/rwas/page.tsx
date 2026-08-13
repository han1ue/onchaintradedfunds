import { SectionCard, StatusBadge } from "@/components/ui";
import { getEligibleAssets } from "@/server/data";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatFeeTier(feeTier: number) {
  return `${feeTier / 10_000}% pool fee`;
}

export const metadata = { title: "Supported RWAs" };

export default async function RwasPage() {
  const assets = await getEligibleAssets();
  const preview = assets.length > 0 && assets.every((asset) => asset.robinhoodUid.startsWith("preview-"));

  return <div className="pageShell contentPage wideContent">
    <header className="pageHeader rwaDirectoryHeader">
      <div>
        <h1>Supported RWAs</h1>
        <p>Assets currently eligible for launch-competition portfolios, with an enabled direct RWA/USDG liquidity pool.</p>
      </div>
      <div className="rwaDirectoryCount"><strong>{assets.length.toLocaleString()}</strong> supported {preview && <StatusBadge>Preview data</StatusBadge>}</div>
    </header>

    <SectionCard className="rwaDirectory">
      <div className="rwaDirectoryHeading"><span>Asset</span><span>Token contract</span><span>Liquidity pool</span><span>Status</span></div>
      {assets.map((asset) => <div className="rwaDirectoryRow" key={asset.id}>
        <div className="rwaDirectoryIdentity"><span className="rwaDirectoryMark">{asset.symbol.slice(0, 3)}</span><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div>
        <span className="rwaDirectoryAddress" title={asset.contractAddress}>{shortAddress(asset.contractAddress)}</span>
        <span className="rwaDirectoryFee" title={asset.poolAddress}>{formatFeeTier(asset.feeTier)} · {shortAddress(asset.poolAddress)}</span>
        <span className="rwaDirectoryStatus">Supported</span>
      </div>)}
      {assets.length === 0 ? <div className="rwaDirectoryEmpty"><strong>No supported RWAs yet</strong><p>Assets will appear here after their token deployment and direct RWA/USDG liquidity pool pass eligibility checks.</p></div> : null}
    </SectionCard>
  </div>;
}
