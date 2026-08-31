import { apiError, apiOk } from "@/server/api";
import { getCompetition } from "@/server/data";
export async function GET() { try { return apiOk(await getCompetition()); } catch (error) { return apiError(error); } }
