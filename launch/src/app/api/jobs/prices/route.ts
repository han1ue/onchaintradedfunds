import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureAssetPrices } from "@/server/prices";
import { currentCompetition } from "@/server/guards";

export async function GET(request: Request) {
  try {
    assertCron(request);
    try {
      await currentCompetition();
    } catch (error) {
      if (error instanceof Error && error.message === "COMPETITION_NOT_OPEN") {
        return apiOk({ active: false, prices: null, markets: null });
      }
      throw error;
    }
    const prices = await captureAssetPrices({ purpose: "scoring" });
    return apiOk({ active: true, prices });
  } catch (error) {
    return apiError(error);
  }
}
