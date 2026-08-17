import { apiError, apiOk } from "@/server/api";
import { getFinalXpAllocation } from "@/server/xp";

export async function GET() {
  try {
    return apiOk(await getFinalXpAllocation());
  } catch (error) {
    return apiError(error);
  }
}
