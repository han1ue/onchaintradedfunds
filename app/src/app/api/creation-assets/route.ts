import { readPrices } from "@/server/pricing";
import { parseFixedDecimal, formatFixedDecimal } from "@/lib/creation-model";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chainId"));
  if (![4663,46630].includes(chainId)) return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  try {
    const observations = await readPrices(chainId);
    const valuation = params.get("purpose") === "valuation";
    const data = observations.filter(price => price.usable && (valuation || price.marketCapUsd)).map(price => ({
      ...price,
      priceUsd: formatFixedDecimal(parseFixedDecimal(price.priceUsd,36)! / 10n ** 18n,18),
      marketCapUsd: price.marketCapUsd ? formatFixedDecimal(parseFixedDecimal(price.marketCapUsd,36)! / 10n ** 18n,18) : "",
    }));
    return Response.json({ data, observations, collectedAt: data.reduce<string | null>((latest,price)=>!latest||price.collectedAt>latest?price.collectedAt:latest,null) }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "ASSET_DATA_UNAVAILABLE", message: "Shared asset prices are unavailable. Refresh after collection resumes." }, { status: 503 }); }
}
