const BASKET_UNIT = 10n ** 17n;
const WAD = 10n ** 18n;

function usdWad(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,18})?$/u.test(value)) {
    throw new Error(`Invalid seed USD value: ${value}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const parsed = BigInt(whole) * WAD + BigInt(fraction.padEnd(18, "0"));
  if (parsed <= 0n) throw new Error("Seed USD values must be positive");
  return parsed;
}

// Use the same Yahoo price and capitalization sources as the testnet asset picker.
export async function testnetSeedMarketSnapshot(assetCatalog, fetchImpl = fetch) {
  const now = Math.floor(Date.now() / 1_000);
  const read = async (url) => {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Seed market data request failed: ${response.status}`);
    return response.json();
  };
  const assets = await Promise.all(assetCatalog.fundAssets.map(async ({ id, symbol }) => {
    const [chart, caps] = await Promise.all([
      read(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`),
      read(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${symbol}?symbol=${symbol}&type=quarterlyMarketCap,trailingMarketCap&period1=${now - 400 * 86400}&period2=${now + 86400}`),
    ]);
    const priceUsd = String(chart?.chart?.result?.[0]?.meta?.regularMarketPrice);
    let marketCapUsd;
    for (const type of ["trailingMarketCap", "quarterlyMarketCap"]) {
      const series = caps?.timeseries?.result?.find((row) => row.meta?.type?.includes(type));
      const latest = series?.[type]?.findLast((row) => {
        const raw = row.reportedValue?.raw;
        return (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0)
          || (typeof raw === "string" && /^\d+(?:\.\d+)?$/u.test(raw) && Number(raw) > 0);
      });
      if (latest) { marketCapUsd = String(latest.reportedValue.raw); break; }
    }
    try { usdWad(priceUsd); usdWad(marketCapUsd); }
    catch { throw new Error(`Missing or invalid seed market data for ${symbol}`); }
    return { id, priceUsd, marketCapUsd };
  }));
  return { capturedAt: new Date().toISOString(), assets };
}

const SEED_DEFINITIONS = [
  {
    name: "Consumer Tech Leaders OTF",
    symbol: "CTECH",
    fundThesis: "Amazon, Tesla, and Netflix offer focused exposure to companies changing how people shop, travel, and watch entertainment.",
    annualCreatorExpenseRatioBps: 0,
    mintFeeBps: 0,
    redeemFeeBps: 0,
    constituentIds: ["amzn", "tsla", "nflx"],
  },
  {
    name: "AI Stack OTF",
    symbol: "AISTK",
    fundThesis: "Palantir, AMD, and Amazon provide AI exposure, with a 10% initial allocation to the OTF protocol token.",
    annualCreatorExpenseRatioBps: 100,
    mintFeeBps: 25,
    redeemFeeBps: 10,
    constituentIds: ["pltr", "amd", "amzn"],
    otfAllocationBps: 1_000n,
  },
  {
    name: "Frontier Five OTF",
    symbol: "FIVE",
    fundThesis: "Five technology and growth stocks, with a 10% initial allocation to the OTF protocol token.",
    annualCreatorExpenseRatioBps: 250,
    mintFeeBps: 100,
    redeemFeeBps: 50,
    constituentIds: ["tsla", "amzn", "pltr", "nflx", "amd"],
    otfAllocationBps: 1_000n,
  },
  {
    name: "Market Cap Five OTF",
    symbol: "MCAP5",
    fundThesis: "Tesla, Amazon, Palantir, Netflix, and AMD weighted by their market capitalizations at creation.",
    annualCreatorExpenseRatioBps: 0,
    mintFeeBps: 0,
    redeemFeeBps: 0,
    constituentIds: ["tsla", "amzn", "pltr", "nflx", "amd"],
    marketCapWeighted: true,
  },
];

export function testnetOtfSeedConfiguration(assetCatalog, expenseBeneficiary, marketSnapshot, otfToken) {
  const assetsById = new Map(
    (assetCatalog?.fundAssets ?? []).map((asset) => [asset.id, asset]),
  );
  const marketsById = new Map((marketSnapshot?.assets ?? []).map((asset) => [asset.id, asset]));

  return SEED_DEFINITIONS.map(({ constituentIds, otfAllocationBps, marketCapWeighted, ...definition }) => {
    const assets = constituentIds.map((id) => {
      const asset = assetsById.get(id);
      if (!asset) throw new Error(`Missing testnet OTF seed constituent ${id}`);
      if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18) {
        throw new Error(`Invalid seed decimals for ${id}`);
      }
      return { ...asset, price: usdWad(marketsById.get(id)?.priceUsd), cap: usdWad(marketsById.get(id)?.marketCapUsd) };
    });
    const constituents = assets.map((asset) => asset.address);
    const totalCap = assets.reduce((sum, asset) => sum + asset.cap, 0n);
    const bootstrapBasketUnitsPerOTF = assets.map((asset) => marketCapWeighted
      ? 100n * WAD * asset.cap * 10n ** BigInt(asset.decimals) / (totalCap * asset.price)
      : BASKET_UNIT * 10n ** BigInt(asset.decimals) / WAD);
    if (otfAllocationBps) {
      if (!/^0x[0-9a-fA-F]{40}$/u.test(otfToken?.address ?? "") || /^0x0{40}$/u.test(otfToken.address)) {
        throw new Error("Missing or invalid deployed OTF token address");
      }
      const stockValue = assets.reduce((sum, asset, index) =>
        sum + bootstrapBasketUnitsPerOTF[index] * asset.price / 10n ** BigInt(asset.decimals), 0n);
      const otfPrice = BigInt(otfToken.priceUsdWad);
      if (otfPrice <= 0n) throw new Error("OTF seed price must be positive");
      constituents.push(otfToken.address);
      bootstrapBasketUnitsPerOTF.push(stockValue * otfAllocationBps * WAD / ((10_000n - otfAllocationBps) * otfPrice));
    }
    if (bootstrapBasketUnitsPerOTF.some((unit) => unit <= 0n)) throw new Error("Seed basket quantity rounds to zero");

    return {
      ...definition,
      expenseBeneficiary,
      constituents,
      bootstrapBasketUnitsPerOTF,
    };
  });
}
