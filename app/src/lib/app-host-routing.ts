export const APP_HOSTNAME = "app.onchaintradedfunds.com";
export const APP_ORIGIN = `https://${APP_HOSTNAME}`;

export function hostnameFromHostHeader(hostHeader: string | null | undefined) {
  const firstHost = hostHeader?.split(",")[0]?.trim().toLowerCase() ?? "";
  return firstHost.split(":")[0].replace(/\.$/, "");
}

export function rootViewForHost(hostHeader: string | null | undefined): "landing" | "swap" {
  return hostnameFromHostHeader(hostHeader) === APP_HOSTNAME ? "swap" : "landing";
}
