import { describe, expect, it } from "vitest";
import { assertXEligible, verifyXPost, type XPost, type XUser } from "./x";

const eligibleUser: XUser = { id: "42", username: "verified", name: "Verified", created_at: "2020-01-01T00:00:00Z", protected: false, verified: true, public_metrics: { followers_count: 100, following_count: 20, tweet_count: 30, listed_count: 1 } };

describe("X eligibility", () => {
  it("enforces verification, public access and followers", () => expect(() => assertXEligible(eligibleUser, { minAccountAgeDays: 30, minFollowers: 100 })).not.toThrow());
  it("rejects protected accounts", () => expect(() => assertXEligible({ ...eligibleUser, protected: true }, { minAccountAgeDays: 30 })).toThrow("X_NOT_VERIFIED"));
  it("rejects low-follower voters", () => expect(() => assertXEligible({ ...eligibleUser, public_metrics: { ...eligibleUser.public_metrics, followers_count: 99 } }, { minAccountAgeDays: 30, minFollowers: 100 })).toThrow("FOLLOWER_THRESHOLD"));
});

describe("X post evidence", () => {
  const proofUrl = "https://launch.example/proof/nonce";
  const post: XPost = { id: "123", author_id: "42", text: "I support this portfolio because the thesis is durable https://t.co/abc", created_at: "2026-01-01T00:05:00Z", edit_history_tweet_ids: ["123"], entities: { urls: [{ expanded_url: proofUrl }] } };
  const expected = { authorId: "42", proofUrl, challengeCreatedAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2026-01-01T00:30:00Z"), allowExpired: true };
  it("accepts the right author, expanded proof URL and user context", () => expect(verifyXPost(post, expected).postId).toBe("123"));
  it("rejects a wrong author", () => expect(() => verifyXPost({ ...post, author_id: "99" }, expected)).toThrow("PROOF_MISMATCH"));
  it("rejects repost evidence", () => expect(() => verifyXPost({ ...post, referenced_tweets: [{ type: "retweeted", id: "1" }] }, expected)).toThrow("PROOF_MISMATCH"));
});
