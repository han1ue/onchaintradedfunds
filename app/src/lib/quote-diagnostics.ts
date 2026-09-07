import { randomUUID } from "node:crypto";
import { QuoteFailure, quoteFailureCode, quoteFailureReasons, type QuoteFailureCode } from "./quote-errors";

// Deliberately omit messages, URLs, headers, calldata, and raw provider responses.
// Viem error messages can contain private RPC URLs and request bodies.
function errorDetails(error: unknown, depth = 0): unknown {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const detail = error as { name?: unknown; status?: unknown; cause?: unknown; data?: { errorName?: unknown } };
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value) ? value : undefined;
  return {
    name: identifier(detail.name),
    status: typeof detail.status === "number" ? detail.status : undefined,
    revert: identifier(detail.data?.errorName),
    ...(error instanceof QuoteFailure ? { code: error.code, ...error.tokens } : {}),
    cause: errorDetails(detail.cause, depth + 1),
    ...(error instanceof AggregateError ? { candidates: error.errors.slice(0, 4).map((cause) => errorDetails(cause, depth + 1)) } : {}),
  };
}

export function unavailableQuoteResponse(
  request: { route: "direct" | "basket"; chainId: number; input: { address: string }; output: { address: string } },
  stage: string,
  error: unknown,
  fallback: QuoteFailureCode = "QUOTE_FAILED",
) {
  const code = quoteFailureCode(error, fallback);
  const requestId = randomUUID();
  console.warn("[swap-quotes] unavailable", {
    requestId, code, stage, route: request.route, chainId: request.chainId,
    inputToken: request.input.address, outputToken: request.output.address,
    error: errorDetails(error),
  });
  return { status: 503, body: { state: "unavailable", route: request.route, reason: quoteFailureReasons[code], code, requestId } };
}
