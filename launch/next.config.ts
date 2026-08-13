import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@onchaintradedfunds/brand"],
  images: { remotePatterns: [{ protocol: "https", hostname: "pbs.twimg.com" }, { protocol: "https", hostname: "abs.twimg.com" }] },
  experimental: { optimizePackageImports: ["lucide-react"] },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://platform.twitter.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com https://cdn.robinhood.com; connect-src 'self' https://api.x.com https://api.robinhood.com https://challenges.cloudflare.com https://syndication.twitter.com https://cdn.syndication.twimg.com; frame-src https://challenges.cloudflare.com https://platform.twitter.com https://syndication.twitter.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://x.com" }
      ]
    }];
  }
};

export default nextConfig;
