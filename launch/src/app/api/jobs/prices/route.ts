import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureMarketEvidence } from "@/server/market-evidence";
import { captureAssetPrices } from "@/server/prices";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const [prices, markets] = await Promise.all([
      captureAssetPrices({ purpose: "scoring" }),
      captureMarketEvidence(),
    ]);
    return apiOk({ prices, markets });
  } catch (error) {
    return apiError(error);
  }
}
