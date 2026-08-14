import { describe, expect, it } from "vitest";
import { approximateXPostLength, buildSubmissionPost, buildVotePost, slugifyProposalName } from "./x-post";

const proposal = { name: "AI Infrastructure OTF", ticker: "AIX", slug: "ai-infrastructure-otf" };

describe("X post templates", () => {
  it("uses one deterministic canonical submission URL", () => {
    expect(buildSubmissionPost("A durable long-term infrastructure thesis.", proposal, "https://launch.example/", "OTF-ABC123")).toBe("A durable long-term infrastructure thesis.\n\nI submitted AI Infrastructure OTF as an OTF proposal to OTF Launch · OTF-ABC123\nhttps://launch.example/otfs/ai-infrastructure-otf");
  });
  it("activates one reusable 100-vote ballot", () => {
    expect(buildVotePost("I want to help choose the strongest proposals.", "https://launch.example", "OTF-ABC123")).toBe("I want to help choose the strongest proposals.\n\nI activated my 100 votes in OTF Launch · OTF-ABC123\nhttps://launch.example/vote");
  });
  it("matches proposal slug generation", () => expect(slugifyProposalName(proposal.name)).toBe(proposal.slug));
  it("counts links at X's shortened-link length", () => expect(approximateXPostLength("Read https://launch.example/a/very/long/path")).toBe(28));
});
