import { verifyProof } from "@/server/actions";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
export async function POST(request: Request) {
  try { assertSameOrigin(request); await enforceRateLimit("proof", request); return apiOk(await verifyProof(await request.json())); } catch (error) { return apiError(error); }
}
