import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("fund fee claim wiring", () => {
  it("shows the claim only to the connected immutable expense beneficiary inside Fund fees", () => {
    expect(component).toContain("address?.toLowerCase() === vaultDetails.expenseBeneficiary.toLowerCase()");
    expect(component).toContain("<FeeClaimPanel vault={vaultDetails.address} beneficiary={vaultDetails.expenseBeneficiary}");
    expect(component.indexOf("<FeeClaimPanel")).toBeGreaterThan(component.indexOf('className="fundFeesPanel"'));
  });

  it("matches the compact claim layout and never labels an unquoted value as WETH", () => {
    expect(component).not.toContain(">Available to claim<");
    expect(component).not.toContain("Annual fees are checkpointed automatically when a claim is submitted.");
    expect(component).toContain('className="fundFeeClaimAmount"');
    expect(component).toContain('expectedCreatorWeth !== undefined\n    ? formatClaimWeth(expectedCreatorWeth)');
    expect(component).toContain('pending?.total === 0n\n        ? "No fees to claim"\n        : "Route unavailable"');
    expect(css).toContain(".fundFeeClaimAmount { display: flex;");
    expect(css).toContain("grid-template-columns: minmax(0, 1.45fr) minmax(104px, 0.55fr)");
  });

  it("quotes both complete-balance routes and lets the beneficiary choose best, sale, or redemption", () => {
    expect(component).toContain("inputAmount: formatUnits(pending.total, 18)");
    expect(component).toContain("quoteService.quoteBasket");
    expect(component).toContain("quoteService.quoteDirect");
    expect(component).toContain('caller: collector');
    expect(component).toContain('value="best">Best available');
    expect(component).toContain('value="share-sale"');
    expect(component).toContain('value="redemption"');
    expect(component).toContain("redemption?.shares === pending.total");
    expect(component).toContain("shareSale?.shares === pending.total");
    expect(component).toContain("proportionalWethSplit(settlementRoute.minWethOut, pending.creator, pending.buyback).buybackWeth");
    expect(component).toContain("feeSettlementCall(settlementRoute, minOtfOut, deadline)");
    expect(component).toContain("functionName: call.functionName");
  });

  it("wires loading, empty, missing-route, rejected, pending, success, and failure states", () => {
    for (const state of ["Quoting…", "No fees to claim", "Route unavailable", "rejected", "pending", "success", "failure"]) {
      expect(component).toContain(state);
    }
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain("The selected settlement route is unavailable. Choose another route.");
  });
});
