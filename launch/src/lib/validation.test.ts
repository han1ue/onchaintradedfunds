import { describe, expect, it } from "vitest";
import { ballotActivationSchema, earliestLaunchAt, parseXPostId, pricingConfigSchema, proposalAssetMetadataSchema, proposalInputSchema, rankEntries, voteDistributionSchema, xPostProofSchema, xPostReasonSchema } from "./validation";
import { normalizeTickerInput } from "./ticker";

const assetA = "11111111-1111-4111-8111-111111111111";
const assetB = "22222222-2222-4222-8222-222222222222";
const directPricing = { source: "chainlink-direct" as const, feedAddress: "0x1111111111111111111111111111111111111111" };
const allocation = (assetId: string, weightBps: number) => ({ assetId, weightBps, pricingConfig: directPricing });
const inlineAsset = {
  network: "robinhood-mainnet" as const,
  chainId: 4663 as const,
  contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  decimals: 18 as const,
  symbol: "new-token",
  name: "New Token",
};
describe("proposal validation", () => {
  it("normalizes ticker input before submission", () => {
    expect(normalizeTickerInput(" aix  ")).toBe("AIX");
    expect(normalizeTickerInput("ai/x-longer-than-sixteen-characters")).toBe("AIX-LONGER-THAN-");
  });
  it("accepts exactly 10,000 basis points across distinct assets", () => {
    expect(proposalInputSchema.parse({ name: "Compute OTF", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [allocation(assetA, 6000), allocation(assetB, 4000)] }).allocations).toHaveLength(2);
  });
  it("allows directory assets to use their configured source without a per-proposal route", () => {
    const parsed = proposalInputSchema.parse({
      name: "Directory OTF",
      ticker: "DIR",
      thesis: "Use the directory price source for both constituents.",
      allocations: [
        { assetId: assetA, weightBps: 5000, pricingConfig: null },
        { assetId: assetB, weightBps: 5000 },
      ],
    });
    expect(parsed.allocations[0]).toMatchObject({ assetId: assetA, pricingConfig: null });
    expect(parsed.allocations[1]).toMatchObject({ assetId: assetB });
  });
  it("accepts a thesis of any non-empty length", () => {
    expect(proposalInputSchema.parse({ name: "Compute OTF", ticker: "CMP", thesis: "A", allocations: [allocation(assetA, 6000), allocation(assetB, 4000)] }).thesis).toBe("A");
  });
  it("rejects allocations that do not total 100%", () => {
    expect(() => proposalInputSchema.parse({ name: "Compute OTF", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [allocation(assetA, 6000), allocation(assetB, 3000)] })).toThrow(/100%/);
  });
  it("rejects duplicate assets and names without the OTF suffix", () => {
    expect(() => proposalInputSchema.parse({ name: "Compute", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [allocation(assetA, 5000), allocation(assetA, 5000)] })).toThrow();
  });

  it("accepts permissionless 18-decimal token metadata with an explicit pricing config", () => {
    const parsed = proposalInputSchema.parse({
      name: "Permissionless OTF",
      ticker: "OPEN",
      thesis: "A mechanically valid portfolio.",
      allocations: [
        { assetMetadata: inlineAsset, weightBps: 5000, pricingConfig: directPricing },
        allocation(assetB, 5000),
      ],
    });
    const metadata = "assetMetadata" in parsed.allocations[0] ? parsed.allocations[0].assetMetadata : null;
    expect(metadata).toMatchObject({ symbol: "NEW-TOKEN", decimals: 18, contractAddress: inlineAsset.contractAddress });
  });

  it("rejects inline metadata that is not exactly 18 decimals", () => {
    expect(() => proposalAssetMetadataSchema.parse({ ...inlineAsset, decimals: 6 })).toThrow();
  });

  it("normalizes inline addresses before duplicate detection", () => {
    expect(() => proposalInputSchema.parse({
      name: "Duplicate OTF",
      ticker: "DUPE",
      thesis: "Duplicate address coverage.",
      allocations: [
        { assetMetadata: inlineAsset, weightBps: 5000, pricingConfig: directPricing },
        { assetMetadata: { ...inlineAsset, contractAddress: inlineAsset.contractAddress.toUpperCase().replace("0X", "0x") }, weightBps: 5000, pricingConfig: directPricing },
      ],
    })).toThrow(/unique/);
  });

  it("accepts only the three exact pricing routes and rejects Uniswap V4", () => {
    expect(pricingConfigSchema.parse(directPricing).source).toBe("chainlink-direct");
    expect(pricingConfigSchema.parse({ source: "chainlink-weth", assetWethFeedAddress: directPricing.feedAddress, wethUsdFeedAddress: "0x2222222222222222222222222222222222222222" }).source).toBe("chainlink-weth");
    expect(pricingConfigSchema.parse({ source: "uniswap-v3", poolAddress: directPricing.feedAddress }).source).toBe("uniswap-v3");
    expect(() => pricingConfigSchema.parse({ source: "uniswap-v4", poolAddress: directPricing.feedAddress })).toThrow();
  });
});

describe("proof links", () => {
  it("allows an empty optional X post reason", () => {
    expect(xPostReasonSchema.parse("")).toBe("");
  });
  it("extracts an immutable post id from X and Twitter URLs", () => {
    expect(parseXPostId("https://x.com/otf/status/1234567890")).toBe("1234567890");
    expect(parseXPostId("https://twitter.com/otf/status/987654321")).toBe("987654321");
  });
  it("accepts copied X post links without a URL scheme", () => {
    const challengeId = "11111111-1111-4111-8111-111111111111";
    expect(xPostProofSchema.parse({ challengeId, postUrl: "x.com/otf/status/1234567890" }).postUrl)
      .toBe("https://x.com/otf/status/1234567890");
    expect(xPostProofSchema.parse({ challengeId, postUrl: " www.twitter.com/otf/status/1234567890 " }).postUrl)
      .toBe("https://www.twitter.com/otf/status/1234567890");
  });
  it("rejects text that is not a post URL", () => {
    expect(xPostProofSchema.safeParse({ challengeId: assetA, postUrl: "OTF-123" }).success).toBe(false);
  });
  it("rejects lookalike hosts", () => expect(() => parseXPostId("https://x.com.evil.test/a/status/1")).toThrow("PROOF_MISMATCH"));
});

describe("earned-vote ballot validation", () => {
  it("accepts a partial set of earned votes across distinct proposals", () => {
    expect(voteDistributionSchema.parse([{ proposalId: assetA, votes: 3 }, { proposalId: assetB, votes: 2 }])).toHaveLength(2);
  });
  it("rejects distributions above the 12-vote maximum", () => {
    expect(() => voteDistributionSchema.parse([{ proposalId: assetA, votes: 7 }, { proposalId: assetB, votes: 6 }])).toThrow(/12/);
  });
  it("rejects duplicate proposals", () => {
    expect(() => voteDistributionSchema.parse([{ proposalId: assetA, votes: 1 }, { proposalId: assetA, votes: 1 }])).toThrow(/unique/);
  });
  it("keeps vote disclosure off unless the voter enables it", () => {
    const ballot = ballotActivationSchema.parse({ reason: "I want to support strong OTF proposals.", allocations: [{ proposalId: assetA, votes: 1 }] });
    expect(ballot.revealVotes).toBe(false);
  });
});

describe("ranking and launch windows", () => {
  it("sorts votes, acceptance time, then immutable id into ordinal ranks", () => {
    const time = new Date("2026-01-01T00:00:00Z");
    const ranked = rankEntries([{ id: "b", votes: 10, acceptedAt: time }, { id: "a", votes: 10, acceptedAt: time }, { id: "c", votes: 11, acceptedAt: new Date("2026-01-02") }]);
    expect(ranked.map((row) => [row.id, row.rank])).toEqual([["c", 1], ["a", 2], ["b", 3]]);
  });
  it("uses independent four-day eligibility intervals", () => {
    expect(earliestLaunchAt(new Date("2026-01-01T00:00:00Z"), 3).toISOString()).toBe("2026-01-09T00:00:00.000Z");
  });
});
