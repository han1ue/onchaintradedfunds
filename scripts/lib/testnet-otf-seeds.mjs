const BASKET_UNIT = 10n ** 17n;

const SEED_DEFINITIONS = [
  {
    name: "Consumer Tech Leaders",
    symbol: "CTECH",
    fundThesis: "Amazon, Tesla, and Netflix offer focused exposure to companies changing how people shop, travel, and watch entertainment.",
    annualCreatorExpenseRatioBps: 0,
    mintFeeBps: 0,
    redeemFeeBps: 0,
    constituentIds: ["amzn", "tsla", "nflx"],
  },
  {
    name: "AI Stack",
    symbol: "AISTK",
    fundThesis: "Palantir, AMD, and Amazon combine software, chips, and cloud infrastructure in one AI-focused basket.",
    annualCreatorExpenseRatioBps: 100,
    mintFeeBps: 25,
    redeemFeeBps: 10,
    constituentIds: ["pltr", "amd", "amzn"],
  },
  {
    name: "Frontier Five",
    symbol: "FIVE",
    fundThesis: "Tesla, Amazon, Palantir, Netflix, and AMD form a broad testnet portfolio of technology and growth stocks.",
    annualCreatorExpenseRatioBps: 250,
    mintFeeBps: 100,
    redeemFeeBps: 50,
    constituentIds: ["tsla", "amzn", "pltr", "nflx", "amd"],
  },
];

export function testnetOtfSeedConfiguration(assetCatalog, expenseBeneficiary) {
  const assetsById = new Map(
    (assetCatalog?.fundAssets ?? []).map((asset) => [asset.id, asset.address]),
  );

  return SEED_DEFINITIONS.map(({ constituentIds, ...definition }) => {
    const constituents = constituentIds.map((id) => {
      const assetAddress = assetsById.get(id);
      if (!assetAddress) throw new Error(`Missing testnet OTF seed constituent ${id}`);
      return assetAddress;
    });

    return {
      ...definition,
      expenseBeneficiary,
      constituents,
      bootstrapBasketUnitsPerOTF: constituents.map(() => BASKET_UNIT),
    };
  });
}
