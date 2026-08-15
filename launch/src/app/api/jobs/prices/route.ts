import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureAssetPrices } from "@/server/prices";
import { recomputeLiveXp } from "@/server/xp";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const prices = await captureAssetPrices();
    const xp = await recomputeLiveXp();
    return apiOk({ prices, xp });
  } catch (error) {
    return apiError(error);
  }
}
