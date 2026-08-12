import { apiError, apiOk } from "@/server/api";
import { reconcileEligibleAssets } from "@/server/assets";
import { assertCron } from "@/server/cron";
export async function GET(request: Request) { try { assertCron(request); return apiOk(await reconcileEligibleAssets()); } catch (error) { return apiError(error); } }
