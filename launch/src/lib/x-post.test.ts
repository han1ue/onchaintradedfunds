import { describe, expect, it } from "vitest";
import { approximateXPostLength, buildSubmissionPost, buildVotePost, slugifyProposalName } from "./x-post";

const proposal = { name: "AI Infrastructure OTF", ticker: "AIX", slug: "ai-infrastructure-otf" };

describe("X post templates", () => {
  it("uses one deterministic canonical submission URL", () => {
    expect(buildSubmissionPost("A durable long-term infrastructure thesis.", proposal, "https://launch.example/", "OTF-ABC123")).toBe("A durable long-term infrastructure thesis.\n\nI submitted AI Infrastructure OTF to OTF Launch · OTF-ABC123\nhttps://launch.example/otfs/ai-infrastructure-otf");
  });
  it("distinguishes a vote from a submission", () => {
    expect(buildVotePost("This deserves to launch because the theme is coherent.", proposal, "https://launch.example", "OTF-ABC123")).toBe("This deserves to launch because the theme is coherent.\n\nI just voted for AI Infrastructure OTF in OTF Launch · OTF-ABC123\nhttps://launch.example/otfs/ai-infrastructure-otf");
  });
  it("matches proposal slug generation", () => expect(slugifyProposalName(proposal.name)).toBe(proposal.slug));
  it("counts links at X's shortened-link length", () => expect(approximateXPostLength("Read https://launch.example/a/very/long/path")).toBe(28));
});
