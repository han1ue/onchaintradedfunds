export const APP_ORIGIN = "https://app.onchaintradedfunds.com";
export const APP_HOSTNAME = "app.onchaintradedfunds.com";

export function isAppHostname(hostname: string | null | undefined): boolean {
  return hostname?.split(":", 1)[0].toLowerCase() === APP_HOSTNAME;
}
