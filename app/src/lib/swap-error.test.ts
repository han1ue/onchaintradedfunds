import { describe, expect, it } from "vitest";
import { swapErrorMessage } from "./swap-error";

describe("swap error messages", () => {
  it("recognizes nested wallet rejection without leaking calldata", () => {
    const error = new Error("Request Arguments: from: 0x123 data: 0xc93a2125", { cause: { code: 4001 } });
    expect(swapErrorMessage(error)).toBe("Request cancelled in your wallet.");
    expect(swapErrorMessage(new Error("User rejected the request. Request Arguments: data: 0xc93a2125"))).toBe("Request cancelled in your wallet.");
  });

  it("provides recovery for gas shortages and hides unknown provider details", () => {
    expect(swapErrorMessage(new Error("insufficient funds for gas * price + value"))).toContain("Reduce the amount or add funds");
    expect(swapErrorMessage(new Error("RPC Request: secret provider data"))).toBe("Swap failed. Refresh the quote and try again.");
  });

  it("does not encourage resubmission when confirmation is uncertain", () => {
    expect(swapErrorMessage(new Error("receipt timeout"), "0x123")).toContain("Check the transaction before trying again");
    expect(swapErrorMessage(new Error("The swap transaction reverted."), "0x123")).toContain("transaction reverted");
  });

  it("handles non-errors and cyclic causes", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(swapErrorMessage(error)).toBe(swapErrorMessage(undefined));
  });
});
