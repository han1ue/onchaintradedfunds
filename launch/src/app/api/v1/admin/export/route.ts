import { exportLaunchOrder } from "@/server/admin";
import { apiError, apiOk } from "@/server/api";
export async function GET(request: Request) { try { const competitionId = new URL(request.url).searchParams.get("competitionId"); if (!competitionId) throw new Error("COMPETITION_REQUIRED"); return apiOk(await exportLaunchOrder(competitionId)); } catch (error) { return apiError(error); } }
