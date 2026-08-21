import { describe, expect, it } from "vitest";
import { approximateXPostLength, buildSubmissionPost, buildVotePost, isValidXPostUrl, slugifyProposalName } from "./x-post";

const proposal = { name: "AI Infrastructure OTF", ticker: "AIX", slug: "ai-infrastructure-otf" };

describe("X post templates", () => {
  it("uses one deterministic canonical submission URL", () => {
    expect(buildSubmissionPost("A durable long-term infrastructure thesis.", proposal, "OTF-ABC123")).toBe("A durable long-term infrastructure thesis.\n\nI submitted AI Infrastructure OTF as an OTF proposal to OTF Launch\nhttps://launch.onchaintradedfunds.com/otfs/ai-infrastructure-otf\nOTF-ABC123");
  });
  it("does not invent submission context when none is provided", () => {
    expect(buildSubmissionPost("", proposal, "OTF-ABC123")).toBe("I submitted AI Infrastructure OTF as an OTF proposal to OTF Launch\nhttps://launch.onchaintradedfunds.com/otfs/ai-infrastructure-otf\nOTF-ABC123");
  });
  it("builds a fresh proof post for a voting action", () => {
    expect(buildVotePost("I want to help choose the strongest proposals.", "OTF-ABC123")).toBe("I want to help choose the strongest proposals.\n\nI just voted in the OTF Launch competition.\nhttps://launch.onchaintradedfunds.com/vote\nOTF-ABC123");
  });
  it("does not invent context before the voter writes it", () => {
    expect(buildVotePost("", "OTF-ABC123")).toBe("I just voted in the OTF Launch competition.\nhttps://launch.onchaintradedfunds.com/vote\nOTF-ABC123");
  });
  it("only reveals OTF picks when choices are supplied", () => {
    const choices = [{ ticker: "AIX", votes: 2 }, { ticker: "MAG7", votes: 1 }];
    expect(buildVotePost("I want to help choose the strongest proposals.", "OTF-ABC123", choices)).toContain("My picks: 2× $AIX, 1× $MAG7");
    expect(buildVotePost("I want to help choose the strongest proposals.", "OTF-ABC123")).not.toContain("My picks:");
  });
  it("matches proposal slug generation", () => expect(slugifyProposalName(proposal.name)).toBe(proposal.slug));
  it("counts links at X's shortened-link length", () => expect(approximateXPostLength("Read https://launch.example/a/very/long/path")).toBe(28));
  it("recognizes canonical X status URLs before server verification", () => {
    expect(isValidXPostUrl("https://x.com/otf/status/1234567890")).toBe(true);
    expect(isValidXPostUrl("twitter.com/otf/status/1234567890")).toBe(true);
    expect(isValidXPostUrl("https://x.com/otf/status/not-a-number")).toBe(false);
    expect(isValidXPostUrl("https://x.com/otf")).toBe(false);
    expect(isValidXPostUrl("https://x.com.evil.test/otf/status/1234567890")).toBe(false);
  });
});
