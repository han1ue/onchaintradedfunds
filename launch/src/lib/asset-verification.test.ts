import { describe, expect, it } from "vitest";
import { deriveOtfVerified } from "./asset-verification";

describe("asset verification", () => {
  it("marks an OTF verified only when every current constituent is verified", () => {
    expect(deriveOtfVerified([true, true])).toBe(true);
    expect(deriveOtfVerified([true, false])).toBe(false);
    expect(deriveOtfVerified([])).toBe(false);
  });
});
