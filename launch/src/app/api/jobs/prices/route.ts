import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { captureAssetPrices } from "@/server/prices";
import { priceCapturePurpose } from "@/server/guards";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const purpose = await priceCapturePurpose();
    if (!purpose) return apiOk({ active: false, purpose: null, prices: null });
    const prices = await captureAssetPrices({ purpose });
    return apiOk({ active: true, purpose, prices });
  } catch (error) {
    return apiError(error);
  }
}
