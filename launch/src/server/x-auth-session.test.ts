import { describe, expect, it, vi } from "vitest";
import { resolveXUserForSignIn } from "./x-auth-session";

describe("X sign-in profile lookup", () => {
  it("never calls TwitterAPI.io for an existing X user", async () => {
    const fetchProfile = vi.fn();
    const result = await resolveXUserForSignIn({ id: "user-1", xUsername: "stored_handle" }, "42", fetchProfile);

    expect(result).toEqual({ kind: "existing", userId: "user-1", username: "stored_handle" });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("calls TwitterAPI.io exactly once for a new X user", async () => {
    const fetchProfile = vi.fn().mockResolvedValue({
      profile: {
        id: "42",
        username: "new_handle",
        name: "New User",
        created_at: "2020-01-01T00:00:00Z",
        protected: false,
        verified: true,
        profile_image_url: "https://example.com/profile.jpg",
        public_metrics: { followers_count: 100, following_count: 10, tweet_count: 20, listed_count: 0 },
      },
      providerProfile: {
        id: "42",
        userName: "new_handle",
        name: "New User",
        followers: 100,
        following: 10,
        statusesCount: 20,
        createdAt: "2020-01-01T00:00:00Z",
      },
    });

    const result = await resolveXUserForSignIn(undefined, "42", fetchProfile);

    expect(result.kind).toBe("new");
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(fetchProfile).toHaveBeenCalledWith("42");
  });
});
