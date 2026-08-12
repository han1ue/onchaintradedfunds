import { describe, expect, it } from "vitest";
import { assertXEligible, hashXPostText, verifyStoredXPost, type XPost, type XUser } from "./x";

const eligibleUser: XUser = { id: "42", username: "verified", name: "Verified", created_at: "2020-01-01T00:00:00Z", protected: false, verified: true, public_metrics: { followers_count: 100, following_count: 20, tweet_count: 30, listed_count: 1 } };

describe("X eligibility", () => {
  it("enforces verification, public access and followers", () => expect(() => assertXEligible(eligibleUser, { minAccountAgeDays: 30, minFollowers: 100 })).not.toThrow());
  it("rejects protected accounts", () => expect(() => assertXEligible({ ...eligibleUser, protected: true }, { minAccountAgeDays: 30 })).toThrow("X_NOT_VERIFIED"));
  it("rejects low-follower voters", () => expect(() => assertXEligible({ ...eligibleUser, public_metrics: { ...eligibleUser.public_metrics, followers_count: 99 } }, { minAccountAgeDays: 30, minFollowers: 100 })).toThrow("FOLLOWER_THRESHOLD"));
});

describe("X post evidence", () => {
  const post: XPost = { id: "123", author_id: "42", text: "I support this portfolio because the thesis is durable https://t.co/abc", created_at: "2026-01-01T00:05:00Z", edit_history_tweet_ids: ["123"] };
  const expected = { authorId: "42", evidenceHash: hashXPostText(post.text) };
  it("accepts an unchanged post from the connected author", () => expect(verifyStoredXPost(post, expected).editHistoryIds).toEqual(["123"]));
  it("rejects a wrong author", () => expect(() => verifyStoredXPost({ ...post, author_id: "99" }, expected)).toThrow("X_POST_CHANGED"));
  it("rejects edited text", () => expect(() => verifyStoredXPost({ ...post, text: "Changed" }, expected)).toThrow("X_POST_CHANGED"));
  it("rejects repost evidence", () => expect(() => verifyStoredXPost({ ...post, referenced_tweets: [{ type: "retweeted", id: "1" }] }, expected)).toThrow("X_POST_CHANGED"));
});
