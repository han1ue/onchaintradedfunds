import { createCompetition } from "@/server/admin";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
export async function POST(request: Request) { try { assertSameOrigin(request); return apiOk(await createCompetition(await request.json()), { status: 201 }); } catch (error) { return apiError(error); } }
