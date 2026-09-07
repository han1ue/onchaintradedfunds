export const quoteFailureReasons = {
  ROUTE_NOT_CONFIGURED: "This quote route is not configured on the selected network.",
  UNSUPPORTED_CONSTITUENT: "A fund constituent has no supported quote route.",
  DEPLOYMENT_MISMATCH: "The configured router or adapter could not be verified.",
  INVALID_ASSET_METADATA: "The selected token or fund metadata could not be verified.",
  POOL_VALIDATION_FAILED: "A swap pool could not be verified.",
  NO_LIQUIDITY: "A required swap pool has no active liquidity.",
  NO_ROUTE: "No executable swap route was found for this amount.",
  PROVIDER_UNAVAILABLE: "The quote provider is unavailable. Try again shortly.",
  PROVIDER_RATE_LIMITED: "The quote provider is busy. Try again shortly.",
  QUOTE_TIMEOUT: "The quote request timed out. Try again.",
  INVALID_PROVIDER_QUOTE: "The provider returned a route that this app cannot execute.",
  SIMULATION_FAILED: "The quoted transaction failed simulation and cannot be used.",
  QUOTE_EXPIRED: "The quote expired before verification finished. Refresh to try again.",
  MINIMUM_OUTPUT_NOT_MET: "The route cannot deliver the required minimum output.",
  QUOTE_FAILED: "The quote could not be completed. Refresh to try again.",
} as const;

export type QuoteFailureCode = keyof typeof quoteFailureReasons;

export class QuoteFailure extends Error {
  constructor(readonly code: QuoteFailureCode, options?: ErrorOptions, readonly tokens?: { tokenIn: string; tokenOut: string }) {
    super(quoteFailureReasons[code], options);
    this.name = "QuoteFailure";
  }
}

export function quoteFailureCode(error: unknown, fallback: QuoteFailureCode = "QUOTE_FAILED", depth = 0): QuoteFailureCode {
  if (depth > 6 || !error || typeof error !== "object") return fallback;
  if (error instanceof QuoteFailure) return quoteFailureCode(error.cause, error.code, depth + 1);
  if (error instanceof AggregateError) {
    const codes = error.errors.map((cause) => quoteFailureCode(cause, fallback, depth + 1));
    return codes.find((code) => code !== "NO_ROUTE" && code !== fallback) ?? codes[0] ?? fallback;
  }
  const detail = error as { name?: unknown; status?: unknown; cause?: unknown };
  if (detail.name === "TimeoutError" || detail.name === "AbortError") return "QUOTE_TIMEOUT";
  const nested = quoteFailureCode(detail.cause, fallback, depth + 1);
  if (nested !== fallback) return nested;
  if (detail.status === 429) return "PROVIDER_RATE_LIMITED";
  if (detail.name === "HttpRequestError" || typeof detail.status === "number" && detail.status >= 500) return "PROVIDER_UNAVAILABLE";
  return quoteFailureCode(detail.cause, fallback, depth + 1);
}

export async function quoteStep<T>(code: QuoteFailureCode, action: () => Promise<T>, tokens?: { tokenIn: string; tokenOut: string }): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    if (cause instanceof QuoteFailure && !tokens) throw cause;
    throw new QuoteFailure(code, { cause }, tokens);
  }
}
