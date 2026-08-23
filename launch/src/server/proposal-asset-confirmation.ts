import type { PricingConfig } from "@/lib/types";
import { validateUnlistedAsset } from "./unlisted-asset-validation";

type ExistingAssetAllocation = {
  assetId: string;
  pricingConfig?: PricingConfig | null;
  weightBps: number;
};

type StoredAsset = {
  id: string;
  contractAddress: string;
  verified: boolean;
};

type StoredMarket = {
  id: string;
  assetId: string;
  poolAddress: string;
  active: boolean;
};

type AssetValidator = (input: {
  assetAddress: string;
  poolAddress: string;
  competitionStartsAt: Date;
}) => Promise<{ status: string }>;

export type ConfirmedExistingAssetSelection = {
  assetId: string;
  marketId: string | null;
  pricingConfig: PricingConfig | null;
  weightBps: number;
};

export async function validateExistingAssetSelection(
  allocation: ExistingAssetAllocation,
  asset: StoredAsset,
  storedMarkets: readonly StoredMarket[],
  competitionStartsAt: Date,
  validate: AssetValidator = validateUnlistedAsset,
): Promise<ConfirmedExistingAssetSelection> {
  if (asset.id !== allocation.assetId) throw new Error("ASSET_NOT_FOUND");
  if (asset.verified) {
    return { assetId: asset.id, marketId: null, pricingConfig: null, weightBps: allocation.weightBps };
  }

  const submittedPool = allocation.pricingConfig?.source === "uniswap-v3"
    ? allocation.pricingConfig.poolAddress.toLowerCase()
    : null;
  if (!submittedPool) throw new Error("UNLISTED_ASSET_MARKET_REQUIRED");

  const market = storedMarkets.find((candidate) => (
    candidate.active
    && candidate.assetId === asset.id
    && candidate.poolAddress.toLowerCase() === submittedPool
  ));
  if (!market) throw new Error("ASSET_MARKET_NOT_FOUND");

  const validation = await validate({
    assetAddress: asset.contractAddress,
    poolAddress: market.poolAddress,
    competitionStartsAt,
  });
  if (validation.status !== "pass") throw new Error("ASSET_MARKET_REQUIREMENTS_NOT_MET");

  return {
    assetId: asset.id,
    marketId: market.id,
    pricingConfig: { source: "uniswap-v3", poolAddress: market.poolAddress },
    weightBps: allocation.weightBps,
  };
}
