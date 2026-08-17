import { evmAddressSchema } from "@/lib/validation";
import { apiError, apiOk } from "@/server/api";
import { env } from "@/server/env";
import { getTokenMetadata } from "@/server/token-metadata";

export async function GET(request: Request) {
  try {
    const address = evmAddressSchema.parse(new URL(request.url).searchParams.get("address"));
    const metadata = await getTokenMetadata(address, env.ROBINHOOD_RPC_URL);
    return apiOk({ address, ...metadata });
  } catch (error) {
    return apiError(error, "TOKEN_METADATA_UNAVAILABLE");
  }
}
