import { handleSwapQuoteRequest } from "@/lib/uniswap-trading-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_SWAP_QUOTE_REQUEST" }, { status: 400 });
  }
  const result = await handleSwapQuoteRequest(body);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
