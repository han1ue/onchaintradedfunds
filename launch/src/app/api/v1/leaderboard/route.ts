import { apiError, apiOk } from "@/server/api";
import { getLeaderboard } from "@/server/data";
export async function GET() { try { return apiOk(await getLeaderboard()); } catch (error) { return apiError(error); } }
