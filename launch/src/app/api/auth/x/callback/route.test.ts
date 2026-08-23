import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeXOAuthState: vi.fn(),
  createXSession: vi.fn(),
  exchangeXOAuthToken: vi.fn(),
  findOrCreateXUser: vi.fn(),
}));

vi.mock("@/server/x-auth-session", () => ({
  consumeXOAuthState: mocks.consumeXOAuthState,
  createXSession: mocks.createXSession,
  findOrCreateXUser: mocks.findOrCreateXUser,
}));
vi.mock("@/server/x-oauth1", () => ({
  canonicalXAuthOrigin: () => "https://launch.example",
  exchangeXOAuthToken: mocks.exchangeXOAuthToken,
}));

import { GET } from "./route";

describe("X OAuth callback identity refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeXOAuthState.mockResolvedValue({ requestTokenSecret: "request-secret", callbackPath: "/me" });
    mocks.exchangeXOAuthToken.mockResolvedValue({ xUserId: "42", screenName: "current_handle" });
    mocks.findOrCreateXUser.mockResolvedValue({ userId: "user-1", username: "current_handle" });
    mocks.createXSession.mockResolvedValue({ sessionToken: "session-token", expires: new Date("2026-09-22T00:00:00Z") });
  });

  it("passes the OAuth screen name with the immutable numeric X ID", async () => {
    const response = await GET(new Request("https://launch.example/api/auth/x/callback?oauth_token=request-token&oauth_verifier=verifier"));

    expect(mocks.exchangeXOAuthToken).toHaveBeenCalledWith("request-token", "request-secret", "verifier");
    expect(mocks.findOrCreateXUser).toHaveBeenCalledWith("42", "current_handle");
    expect(response.headers.get("location")).toBe("https://launch.example/me");
  });
});
