import { apiError, apiOk, parsePublicListQuery } from "@/server/api";
import { getPublicLaunchOrder } from "@/server/data";
export async function GET(request: Request) {
  try {
    const { limit, cursor, q } = parsePublicListQuery(request);
    return apiOk(await getPublicLaunchOrder({ limit, cursor, search: q }));
  } catch (error) {
    return apiError(error);
  }
}
