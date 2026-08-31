import { apiError, apiOk } from "@/server/api";
import { getXActionChallengeStatus } from "@/server/challenge-results";

export async function GET(_request: Request, context: { params: Promise<{ challengeId: string }> }) {
  try {
    return apiOk(await getXActionChallengeStatus((await context.params).challengeId), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
