import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { recomputeLiveXp } from "@/server/xp";
import { captureMarketEvidence } from "@/server/market-evidence";
import { captureAssetPrices } from "@/server/prices";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const [prices, markets] = await Promise.all([
      captureAssetPrices({ purpose: "scoring" }),
      captureMarketEvidence(),
    ]);
    const xp = await recomputeLiveXp();
    return apiOk({ prices, markets, xp });
  } catch (error) {
    return apiError(error);
  }
}
