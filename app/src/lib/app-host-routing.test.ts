import { describe, expect, it } from "vitest";
import { APP_ORIGIN, hostnameFromHostHeader, rootViewForHost } from "./app-host-routing";

describe("app host routing", () => {
  it("opens the operating app on the app subdomain", () => {
    expect(rootViewForHost("app.onchaintradedfunds.com")).toBe("swap");
    expect(rootViewForHost("APP.ONCHAINTRADEDFUNDS.COM:443")).toBe("swap");
  });

  it("keeps the splash on the public site and other hosts", () => {
    expect(rootViewForHost("onchaintradedfunds.com")).toBe("landing");
    expect(rootViewForHost("www.onchaintradedfunds.com")).toBe("landing");
    expect(rootViewForHost("app.onchaintradedfunds.com.evil.example")).toBe("landing");
    expect(rootViewForHost("localhost:3000")).toBe("landing");
    expect(rootViewForHost(null)).toBe("landing");
  });

  it("uses the first forwarded host and exposes the canonical app origin", () => {
    expect(hostnameFromHostHeader("app.onchaintradedfunds.com, proxy.internal")).toBe("app.onchaintradedfunds.com");
    expect(APP_ORIGIN).toBe("https://app.onchaintradedfunds.com");
  });
});
