function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function httpsUrl(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be an HTTPS URL.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must be an HTTPS URL.`);
  return value;
}

/** Configuration owned by the app rather than emitted by a contract deployment. */
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

export function withAppOwnedIntegrationConfiguration(deployment, config) {
  return { ...deployment, ...appOwnedIntegrationConfiguration(config) };
}
