import { exportLaunchOrder } from "@/server/admin";
import { apiError, apiOk } from "@/server/api";
export async function GET() { try { return apiOk(await exportLaunchOrder()); } catch (error) { return apiError(error); } }
