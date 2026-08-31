import { describe, expect, it } from "vitest";
import { apiError, DEFAULT_PUBLIC_LIST_LIMIT, MAX_PUBLIC_LIST_LIMIT, parsePublicListQuery } from "./api";

describe("public list query validation", () => {
  it("uses the bounded default and parses a stable rank cursor", () => {
    expect(parsePublicListQuery(new Request("https://launch.example/api/leaderboard?cursor=50&q=AI"))).toEqual({
      limit: DEFAULT_PUBLIC_LIST_LIMIT,
      cursor: 50,
      q: "AI",
    });
  });

  it("accepts the hard maximum", () => {
    expect(parsePublicListQuery(new Request(`https://launch.example/api/leaderboard?limit=${MAX_PUBLIC_LIST_LIMIT}`)).limit).toBe(MAX_PUBLIC_LIST_LIMIT);
  });

  it.each(["0", "101", "2.5", "nope"])("rejects invalid limit %s", (limit) => {
    expect(() => parsePublicListQuery(new Request(`https://launch.example/api/leaderboard?limit=${limit}`))).toThrow("INVALID_QUERY");
  });

  it.each(["0", "-1", "1.5", "next"])("rejects invalid cursor %s", (cursor) => {
    expect(() => parsePublicListQuery(new Request(`https://launch.example/api/leaderboard?cursor=${cursor}`))).toThrow("INVALID_QUERY");
  });
});

describe("public API error status", () => {
  it("marks an unavailable stored challenge result as retryable", () => {
    expect(apiError(new Error("CHALLENGE_RESULT_UNAVAILABLE")).status).toBe(503);
  });
});
