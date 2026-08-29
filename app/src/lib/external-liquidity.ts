import { getAddress, isAddress } from "viem";

export const UNISWAP_V3_POSITION_URL = "https://app.uniswap.org/add/v3";
export const UNISWAP_V3_DEFAULT_FEE = 3_000;

/** Builds Uniswap's add-position URL only when both selected tokens are valid addresses. */
export function uniswapV3AddPositionUrl(tokenA?: string, tokenB?: string, fee = UNISWAP_V3_DEFAULT_FEE): string {
  const url = new URL(UNISWAP_V3_POSITION_URL);
  url.searchParams.set("chain", "robinhood");
  if (
    typeof tokenA !== "string"
    || typeof tokenB !== "string"
    || !isAddress(tokenA)
    || !isAddress(tokenB)
    || !Number.isSafeInteger(fee)
    || fee <= 0
  ) return url.toString();
  url.searchParams.set("currencyA", getAddress(tokenA));
  url.searchParams.set("currencyB", getAddress(tokenB));
  url.searchParams.set("fee", String(fee));
  return url.toString();
}

/** Synthra's testnet add-liquidity route is a hash route under its configured HTTPS origin. */
export function synthraAddLiquidityUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return undefined;
    url.hash = "/add/ETH";
    return url.toString();
  } catch {
    return undefined;
  }
}
