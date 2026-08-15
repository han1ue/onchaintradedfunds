import { apiError, apiOk } from "@/server/api";
import { getLeaderboard, getVoterLeaderboard } from "@/server/data";
export async function GET(request: Request) { try { return apiOk(new URL(request.url).searchParams.get("view") === "voters" ? await getVoterLeaderboard() : await getLeaderboard()); } catch (error) { return apiError(error); } }
