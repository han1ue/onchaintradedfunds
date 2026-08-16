import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureMarketEvidence } from "@/server/market-evidence";

export async function GET(request: Request) {
  try {
    assertCron(request);
    return apiOk(await captureMarketEvidence());
  } catch (error) {
    return apiError(error);
  }
}
