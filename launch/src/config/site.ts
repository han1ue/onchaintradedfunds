export const PUBLIC_SITE_ORIGIN = "https://launch.onchaintradedfunds.com";
export const PUBLIC_SITE_HOSTNAME = "launch.onchaintradedfunds.com";

export function publicSiteUrl(pathname: string) {
  return new URL(pathname, `${PUBLIC_SITE_ORIGIN}/`).toString();
}
