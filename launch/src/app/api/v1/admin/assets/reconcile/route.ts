import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { requireAdmin } from "@/server/admin";
import { reconcileEligibleAssets } from "@/server/assets";
export async function POST(request: Request) { try { assertSameOrigin(request); await requireAdmin(); return apiOk(await reconcileEligibleAssets()); } catch (error) { return apiError(error); } }
