import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { recomputeLiveXp } from "@/server/xp";
import { captureMarketEvidence } from "@/server/market-evidence";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const markets = await captureMarketEvidence();
    const xp = await recomputeLiveXp();
    return apiOk({ markets, xp });
  } catch (error) {
    return apiError(error);
  }
}
