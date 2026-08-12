import { finalizeCompetition } from "@/server/admin";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
export async function POST(request: Request) { try { assertSameOrigin(request); const body = await request.json(); return apiOk(await finalizeCompetition(String(body.competitionId))); } catch (error) { return apiError(error); } }
