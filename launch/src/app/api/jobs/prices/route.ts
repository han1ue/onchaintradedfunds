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
    if (purpose === "final" && !prices.complete) throw new Error("FINAL_PRICE_CHECKPOINT_INCOMPLETE");
    return apiOk({ active: purpose === "scoring", purpose, prices });
  } catch (error) {
    return apiError(error);
  }
}
