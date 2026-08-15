import { describe, expect, it } from "vitest";
import { PublicApiError } from "@/lib/errors";
import { assertCompleteProposalPriceCapture } from "./prices";

describe("proposal price acceptance gate", () => {
  const assets = [{ symbol: "AAPL" }, { symbol: "NVDA" }];

  it("rejects a proposal unless every constituent was stored in one complete capture", () => {
    expect(() => assertCompleteProposalPriceCapture({ runId: "run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets))
      .toThrowError("PROPOSAL_PRICE_UNAVAILABLE");
    try {
      assertCompleteProposalPriceCapture({ runId: "run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets);
    } catch (error) {
      expect(error).toBeInstanceOf(PublicApiError);
      expect((error as PublicApiError).metadata).toEqual({ missingSymbols: ["NVDA"] });
    }
  });

  it("returns the auditable complete checkpoint reference used by acceptance", () => {
    expect(assertCompleteProposalPriceCapture({ runId: "complete-run", sampledAt: new Date(), stored: 2, complete: true, missing: [] }, assets)).toBe("complete-run");
  });

  it("fails before draft, challenge, or evidence state can be mutated", () => {
    const state = { proposal: "draft", challengeConsumed: false, evidenceCreated: false };
    expect(() => {
      assertCompleteProposalPriceCapture({ runId: "partial-run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets);
      state.proposal = "accepted";
      state.challengeConsumed = true;
      state.evidenceCreated = true;
    }).toThrowError("PROPOSAL_PRICE_UNAVAILABLE");
    expect(state).toEqual({ proposal: "draft", challengeConsumed: false, evidenceCreated: false });
  });
});
