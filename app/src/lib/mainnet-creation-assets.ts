import { type CatalogAsset } from "./asset-catalog";
import { parseFixedDecimal } from "./creation-model";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Only configured, active stock identities with a one-share multiplier can use stock prices. */
export function mainnetStockAssetsFromRobinhood(payload: unknown, assets: readonly CatalogAsset[]) {
  const rows = record(payload).assets;
  if (!Array.isArray(rows)) return [];
  return assets.filter(asset => asset.chainId === 4663).filter((asset) => asset.id !== "usdg" && asset.id !== "weth").filter((asset) => rows.some((value) => {
    const row = record(value);
    return row.tokenSymbol === asset.symbol && row.tokenDecimals === asset.decimals
      && row.status === "ASSET_STATUS_ACTIVE"
      && typeof row.currentMultiplier === "string" && parseFixedDecimal(row.currentMultiplier, 18) === 10n ** 18n
      && Array.isArray(row.deployments) && row.deployments.some((value) => {
        const deployment = record(value);
        return deployment.chainId === 4663 && typeof deployment.contractAddress === "string"
          && deployment.contractAddress.toLowerCase() === asset.address.toLowerCase();
      });
  }));
}
