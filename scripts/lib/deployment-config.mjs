function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function httpsUrl(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be an HTTPS URL.`);
  try {
    if (new URL(value).protocol === "https:") return value;
  } catch {
    // Use the common validation error below.
  }
  throw new Error(`${name} must be an HTTPS URL.`);
}

/** Returns app-owned settings that a contract deployment must not overwrite. */
export function appOwnedIntegrationConfiguration(config) {
  const source = record(config, "deployment config");
  const liquidity = record(source.externalLiquidity, "externalLiquidity");
  const quoteService = record(source.quoteService, "quoteService");

  if (typeof liquidity.venue !== "string" || !liquidity.venue.trim()) {
    throw new Error("externalLiquidity.venue must be a non-empty string.");
  }
  const endpoint = quoteService.endpoint;
  if (endpoint !== null) {
    try {
      httpsUrl(endpoint, "quoteService.endpoint");
    } catch {
      throw new Error("quoteService.endpoint must be null or an HTTPS URL.");
    }
  }

  return {
    externalLiquidity: {
      venue: liquidity.venue,
      baseUrl: httpsUrl(liquidity.baseUrl, "externalLiquidity.baseUrl"),
    },
    quoteService: { endpoint },
  };
}
