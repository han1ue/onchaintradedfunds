import { apiError, apiOk } from "@/server/api";
import { getPublicLaunchOrder } from "@/server/data";
export async function GET() { try { return apiOk(await getPublicLaunchOrder()); } catch (error) { return apiError(error); } }
