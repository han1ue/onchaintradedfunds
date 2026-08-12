import { apiError, apiOk } from "@/server/api";
import { getEligibleAssets } from "@/server/data";
export async function GET() { try { return apiOk(await getEligibleAssets()); } catch (error) { return apiError(error); } }
