import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  requestXOAuthToken: vi.fn(),
  storeXOAuthState: vi.fn(),
}));

vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/server/x-auth-session", () => ({ storeXOAuthState: mocks.storeXOAuthState }));
vi.mock("@/server/x-oauth1", () => ({
  canonicalXAuthOrigin: () => "https://launch.example",
  requestXOAuthToken: mocks.requestXOAuthToken,
  sanitizeCallbackPath: () => "/",
  xAuthenticateUrl: (token: string) => `https://x.com/i/oauth/authenticate?oauth_token=${token}`,
}));

import { GET } from "./route";

describe("X OAuth initiation abuse controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestXOAuthToken.mockResolvedValue({ requestToken: "request-token", requestTokenSecret: "request-secret" });
  });

  it("rate-limits before requesting a token from X", async () => {
    const request = new Request("https://launch.example/api/auth/x");
    const response = await GET(request);

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("oauth", request);
    expect(mocks.enforceRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.requestXOAuthToken.mock.invocationCallOrder[0]);
    expect(mocks.storeXOAuthState).toHaveBeenCalledWith("request-token", "request-secret", "/");
    expect(response.headers.get("location")).toBe("https://x.com/i/oauth/authenticate?oauth_token=request-token");
  });

  it("does not call X when the rate limit rejects the request", async () => {
    mocks.enforceRateLimit.mockRejectedValueOnce(new Error("RATE_LIMITED"));

    const response = await GET(new Request("https://launch.example/api/auth/x"));

    expect(mocks.requestXOAuthToken).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://launch.example/?authError=x_signin_rate_limited");
  });
});
