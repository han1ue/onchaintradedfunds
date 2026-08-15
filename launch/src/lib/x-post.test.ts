import { describe, expect, it } from "vitest";
import { approximateXPostLength, buildSubmissionPost, buildVotePost, slugifyProposalName } from "./x-post";

const proposal = { name: "AI Infrastructure OTF", ticker: "AIX", slug: "ai-infrastructure-otf" };

describe("X post templates", () => {
  it("uses one deterministic canonical submission URL", () => {
    expect(buildSubmissionPost("A durable long-term infrastructure thesis.", proposal, "https://launch.example/", "OTF-ABC123")).toBe("A durable long-term infrastructure thesis.\n\nI submitted AI Infrastructure OTF as an OTF proposal to OTF Launch · OTF-ABC123\nhttps://launch.example/otfs/ai-infrastructure-otf");
  });
  it("builds a fresh proof post for a voting transaction", () => {
    expect(buildVotePost("I want to help choose the strongest proposals.", "https://launch.example", "OTF-ABC123")).toBe("I want to help choose the strongest proposals.\n\nI cast unlocked votes in OTF Launch\nOTF-ABC123\nhttps://launch.example/vote");
  });
  it("only reveals OTF picks when choices are supplied", () => {
    const choices = [{ ticker: "AIX", votes: 2 }, { ticker: "MAG7", votes: 1 }];
    expect(buildVotePost("I want to help choose the strongest proposals.", "https://launch.example", "OTF-ABC123", choices)).toContain("My picks: 2× $AIX, 1× $MAG7");
    expect(buildVotePost("I want to help choose the strongest proposals.", "https://launch.example", "OTF-ABC123")).not.toContain("My picks:");
  });
  it("matches proposal slug generation", () => expect(slugifyProposalName(proposal.name)).toBe(proposal.slug));
  it("counts links at X's shortened-link length", () => expect(approximateXPostLength("Read https://launch.example/a/very/long/path")).toBe(28));
});
