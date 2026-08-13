export const launchAssets = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "ASML", name: "ASML Holding" },
  { symbol: "BABA", name: "Alibaba Group" },
  { symbol: "COIN", name: "Coinbase" },
  { symbol: "COST", name: "Costco Wholesale" },
  { symbol: "CRCL", name: "Circle Internet Group" },
  { symbol: "GME", name: "GameStop" },
  { symbol: "GOOGL", name: "Alphabet Class A" },
  { symbol: "INTC", name: "Intel" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "MSTR", name: "Strategy" },
  { symbol: "MU", name: "Micron Technology" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "PLTR", name: "Palantir Technologies" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" },
  { symbol: "QUBT", name: "Quantum Computing Inc." },
  { symbol: "RDDT", name: "Reddit" },
  { symbol: "SGOV", name: "iShares 0–3 Month Treasury Bond ETF" },
  { symbol: "SLV", name: "iShares Silver Trust" },
  { symbol: "SNDK", name: "Sandisk" },
  { symbol: "SPCX", name: "SpaceX" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing" },
  { symbol: "TTWO", name: "Take-Two Interactive" },
  { symbol: "USO", name: "United States Oil Fund" }
] as const;

export const launchAssetSymbols = new Set<string>(launchAssets.map(({ symbol }) => symbol));

export function isLaunchAsset(symbol: string) {
  return launchAssetSymbols.has(symbol.toUpperCase());
}

export function getLaunchAssetName(symbol: string) {
  return launchAssets.find((asset) => asset.symbol === symbol.toUpperCase())?.name;
}
