import { describe, expect, it } from "vitest";
import {
  TOTAL_PERCENT_UNITS,
  annualExpenseRatioBpsFromPercentage,
  calculateBootstrapBasketUnits,
  creationAssetsFromApi,
  creationSubmissionLocked,
  creationWriteFailureMessage,
  formatAnnualExpenseRatioPercentage,
  formatPercentageDisplay,
  minimumPercentageUnitsForOneRaw,
  normalizeMarketCapPercentageUnits,
  normalizeFundThesisLineBreaks,
  percentageTotal,
  percentageUnits,
  percentageUnitsForSelectionChange,
  previewBootstrapBasketUnits,
  submitAndConfirmCreation,
  vaultCreationTransactionParams,
  zeroRawUnitError,
} from "./creation-model";

describe("creator expense ratio percentage", () => {
  it("converts percentage input to exact integer basis points", () => {
    expect(annualExpenseRatioBpsFromPercentage("0")).toBe(0);
    expect(annualExpenseRatioBpsFromPercentage("1.25")).toBe(125);
    expect(annualExpenseRatioBpsFromPercentage("10")).toBe(1_000);
    expect(annualExpenseRatioBpsFromPercentage("1.234")).toBeNaN();
    expect(formatAnnualExpenseRatioPercentage(125)).toBe("1.25%");
    expect(formatAnnualExpenseRatioPercentage(1_000)).toBe("10%");
  });
});

describe("vault creation transaction params", () => {
  it("trims the permanent onchain fund thesis", () => {
    expect(vaultCreationTransactionParams({
      name: "Technology OTF",
      symbol: "TECH",
      fundThesis: "  Permanent technology exposure.  ",
      expenseBeneficiary: "0x0000000000000000000000000000000000000001",
      annualCreatorExpenseRatioBps: 100,
      mintFeeBps: 25,
      redeemFeeBps: 10,
      constituents: ["0x0000000000000000000000000000000000000002"],
      bootstrapBasketUnitsPerOTF: [1n],
    })).toEqual(expect.objectContaining({
      fundThesis: "Permanent technology exposure.",
      mintFeeBps: 25,
      redeemFeeBps: 10,
    }));
  });

  it("replaces fund thesis line breaks with spaces", () => {
    expect(normalizeFundThesisLineBreaks("Infrastructure\nfor\r\nthe\rnew era"))
      .toBe("Infrastructure for the new era");
    expect(normalizeFundThesisLineBreaks("One  \n  \n  thesis"))
      .toBe("One thesis");
    expect(normalizeFundThesisLineBreaks("Global\u2028assets\u2029onchain"))
      .toBe("Global assets onchain");
  });
});

function pct(value: string): bigint {
  const units = percentageUnits(value);
  if (units === undefined) throw new Error(`Invalid test percentage: ${value}`);
  return units;
}

describe("creation market-cap defaults", () => {
  it("uses exact current price and market-cap strings from the existing asset source", () => {
    expect(creationAssetsFromApi({ data: [{
      chainId: 4663,
      contractAddress: "0x0000000000000000000000000000000000000001",
      decimals: 18,
      symbol: "ONE",
      name: "Asset One",
      verified: true,
      latestPriceUsdExact: "12.345678901234567890",
      latestPriceAt: "2026-08-30T00:00:00.000Z",
      marketCapUsd: "987654321.12",
    }] }, 4663)).toEqual([expect.objectContaining({
      priceUsd: "12.345678901234567890",
      marketCapUsd: "987654321.12",
    })]);
  });

  it("normalizes market caps deterministically at 18-decimal precision to exactly 100%", () => {
    const percentages = normalizeMarketCapPercentageUnits(["1", "1", "1"]);
    expect(percentages).toEqual([
      33_333_333_333_333_333_334n,
      33_333_333_333_333_333_333n,
      33_333_333_333_333_333_333n,
    ]);
    expect(percentages.reduce((sum, value) => sum + value, 0n)).toBe(TOTAL_PERCENT_UNITS);
  });

  it("keeps a tiny representable market-cap default nonzero and displays tiny weights adaptively", () => {
    const percentages = normalizeMarketCapPercentageUnits(["899999980952", "100000000000", "19048"]);
    expect(percentages).toEqual([pct("89.9999980952"), pct("10"), pct("0.0000019048")]);
    expect(previewBootstrapBasketUnits([{
      symbol: "TINY",
      decimals: 18,
      percentageUnits: percentages[2],
      priceUsd: "100000",
    }])[0].rawQuantity).toBe(190_480n);
    expect(formatPercentageDisplay(pct("0.0000019048"))).toBe("0.0000019048%");
    expect(formatPercentageDisplay(pct("0.000000001"))).toBe("<0.00000001%");
  });
});

describe("selection percentage behavior", () => {
  it("adds new manual constituents at 0% and deletes removed weights without rebalancing", () => {
    const current = [
      { key: "A", percentageUnits: pct("71.123456789012345678") },
      { key: "B", percentageUnits: pct("28.876543210987654322") },
    ];
    const added = percentageUnitsForSelectionChange(current, [
      { key: "A", marketCapUsd: "8" },
      { key: "B", marketCapUsd: "1" },
      { key: "C", marketCapUsd: "1" },
    ], false);
    expect(added.slice(0, 2)).toEqual(current.map((item) => item.percentageUnits));
    expect(added[2]).toBe(0n);

    const removed = percentageUnitsForSelectionChange(
      [...current, { key: "C", percentageUnits: added[2] }],
      [{ key: "A", marketCapUsd: "8" }, { key: "C", marketCapUsd: "1" }],
      false,
    );
    expect(removed).toEqual([current[0].percentageUnits, added[2]]);
  });

  it("automatically realigns the full selection while market-cap weighting is selected", () => {
    const reset = percentageUnitsForSelectionChange([
      { key: "A", percentageUnits: pct("100") },
    ], [
      { key: "A", marketCapUsd: "3" },
      { key: "B", marketCapUsd: "1" },
      { key: "C", marketCapUsd: "1" },
    ], true);
    expect(reset).toEqual([pct("60"), pct("20"), pct("20")]);
    expect(reset.reduce((sum, value) => sum + value, 0n)).toBe(TOTAL_PERCENT_UNITS);
  });
});

describe("fixed $1 bootstrap basket calculation", () => {
  it("requires at least two constituents", () => {
    expect(() => calculateBootstrapBasketUnits([{
      symbol: "ONLY",
      decimals: 18,
      percentageUnits: pct("100"),
      priceUsd: "1",
    }])).toThrow("at least two assets");
  });

  it("uses only bigint fixed-point arithmetic and rounds raw units down", () => {
    const result = calculateBootstrapBasketUnits([
      { symbol: "A", decimals: 18, percentageUnits: pct("60"), priceUsd: "2" },
      { symbol: "B", decimals: 6, percentageUnits: pct("40"), priceUsd: "5" },
    ]);
    expect(result.targetValueUsd).toBe("1");
    expect(result.bootstrapBasketUnitsPerOTF).toEqual([300_000_000_000_000_000n, 80_000n]);
    expect(result.rows.map((row) => row.tokenQuantity)).toEqual(["0.3", "0.08"]);
    expect(result.realizedValueUsd).toBe("1");
  });

  it("requires positive weights totaling the exact 18-decimal internal 100%", () => {
    expect(percentageTotal(["10.125", "20.375", "69.5"])).toBe(TOTAL_PERCENT_UNITS);
    expect(() => calculateBootstrapBasketUnits([
      { symbol: "ZERO", decimals: 18, percentageUnits: 0n, priceUsd: "1" },
      { symbol: "FULL", decimals: 18, percentageUnits: pct("100"), priceUsd: "1" },
    ])).toThrow("positive percentage");
    expect(() => calculateBootstrapBasketUnits([
      { symbol: "A", decimals: 18, percentageUnits: pct("50"), priceUsd: "1" },
      { symbol: "B", decimals: 18, percentageUnits: pct("49.999999999999999999"), priceUsd: "1" },
    ])).toThrow("exactly 100%");
  });

  it("reports the asset-specific zero-raw-unit recovery message", () => {
    const asset = {
      symbol: "HIGH",
      decimals: 6,
      percentageUnits: pct("9.9999"),
      priceUsd: "100000",
    };
    const row = previewBootstrapBasketUnits([asset])[0];
    expect(row.rawQuantity).toBe(0n);
    expect(zeroRawUnitError(asset, row)).toBe(
      "At the fixed $1 target, HIGH’s 9.9999% allocation is less than one raw token unit. Increase its percentage or remove it.",
    );
  });

  it("calculates minimum weights for a $100k token at 18, 8, 6, and 0 decimals", () => {
    expect(minimumPercentageUnitsForOneRaw("100000", 18)).toBe(pct("0.00000000001"));
    expect(minimumPercentageUnitsForOneRaw("100000", 8)).toBe(pct("0.1"));
    expect(minimumPercentageUnitsForOneRaw("100000", 6)).toBe(pct("10"));
    expect(minimumPercentageUnitsForOneRaw("100000", 0)).toBe(pct("10000000"));
  });

  it("explains when token precision makes a $1 inclusion impossible", () => {
    const asset = {
      symbol: "WHOLE",
      decimals: 0,
      percentageUnits: pct("100"),
      priceUsd: "100000",
    };
    const row = previewBootstrapBasketUnits([asset])[0];
    expect(row.minimumPercentageUnits).toBeGreaterThan(TOTAL_PERCENT_UNITS);
    expect(zeroRawUnitError(asset, row)).toBe(
      "WHOLE cannot be included in a $1 OTF because its token precision requires at least 10000000% to produce one raw token unit, which exceeds 100%.",
    );
  });
});

describe("creation submission settlement", () => {
  const hash = "0x1234" as const;

  it("keeps pre-broadcast rejection retryable", async () => {
    let receiptCalled = false;
    await expect(submitAndConfirmCreation({
      write: async () => { throw new Error("User rejected"); },
      waitForReceipt: async () => { receiptCalled = true; return "success"; },
    })).resolves.toEqual({
      status: "failure",
      phase: "write",
      message: "The wallet request was cancelled. Nothing was submitted. You can try again.",
    });
    expect(receiptCalled).toBe(false);
    expect(creationSubmissionLocked("failure")).toBe(false);
  });

  it("locks only active or irreversible submission states", () => {
    expect(creationSubmissionLocked("idle")).toBe(false);
    expect(creationSubmissionLocked("failure")).toBe(false);
    expect(creationSubmissionLocked("submitting")).toBe(true);
    expect(creationSubmissionLocked("success")).toBe(true);
    expect(creationSubmissionLocked("unknown")).toBe(true);
  });

  it("uses concise wallet errors instead of verbose provider details", () => {
    expect(creationWriteFailureMessage({
      shortMessage: "User rejected the request.",
      message: "User rejected the request.\n\nRequest Arguments:\n  from: 0x1234",
    })).toBe("The wallet request was cancelled. Nothing was submitted. You can try again.");
    expect(creationWriteFailureMessage(new Error("Simulation failed\nLong provider diagnostics"))).toBe("Simulation failed");
  });

  it("distinguishes an explicit onchain revert", async () => {
    await expect(submitAndConfirmCreation({
      write: async () => hash,
      waitForReceipt: async () => "reverted",
    })).resolves.toEqual({ status: "failure", phase: "receipt", hash });
  });

  it("locks an indeterminate receipt lookup as unknown", async () => {
    await expect(submitAndConfirmCreation({
      write: async () => hash,
      waitForReceipt: async () => { throw new Error("RPC timeout"); },
    })).resolves.toEqual({ status: "unknown", hash });
  });

  it("returns success only after a successful receipt", async () => {
    let broadcastHash: string | undefined;
    await expect(submitAndConfirmCreation({
      write: async () => hash,
      onBroadcast: (value) => { broadcastHash = value; },
      waitForReceipt: async () => "success",
    })).resolves.toEqual({ status: "success", hash });
    expect(broadcastHash).toBe(hash);
  });
});
