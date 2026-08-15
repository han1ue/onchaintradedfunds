import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureAssetPrices } from "@/server/prices";

export async function GET(request: Request) {
  try {
    assertCron(request);
    return apiOk(await captureAssetPrices());
  } catch (error) {
    return apiError(error);
  }
}
