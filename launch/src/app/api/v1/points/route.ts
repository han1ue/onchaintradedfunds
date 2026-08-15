import { apiError, apiOk } from "@/server/api";
import { getXpLeaderboard } from "@/server/xp";

export async function GET() {
  try {
    return apiOk(await getXpLeaderboard());
  } catch (error) {
    return apiError(error);
  }
}
