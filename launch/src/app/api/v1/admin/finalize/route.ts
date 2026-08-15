import { finalizeCompetition } from "@/server/admin";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
export async function POST(request: Request) { try { assertSameOrigin(request); return apiOk(await finalizeCompetition()); } catch (error) { return apiError(error); } }
