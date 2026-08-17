export type AssetMarketRequirementStatus = "pass" | "fail" | "pending" | "unavailable";
export type AssetMarketRequirementSource = "robinhood-rpc" | "geckoterminal";

export type AssetMarketRequirement = {
  key: string;
  label: string;
  required: string;
  observed: string | number | boolean | null;
  status: AssetMarketRequirementStatus;
  source: AssetMarketRequirementSource;
};

export type AssetMarketValidationResponse = {
  status: AssetMarketRequirementStatus;
  asset: { address: string; name: string; symbol: string; decimals: number } | null;
  market: {
    poolAddress: string;
    factoryAddress: string | null;
    quoteTokenAddress: string | null;
    feeTier: number | null;
    poolCreatedAt: string | null;
  };
  requirements: AssetMarketRequirement[];
};
