import { describe, expect, it } from "vitest";
import { normalizeWholeNumberInput } from "./numeric-input";

describe("whole-number inputs", () => {
  it("allows the field to stay empty", () => {
    expect(normalizeWholeNumberInput("", 100)).toBe("");
  });

  it("keeps digits and removes native-number punctuation", () => {
    expect(normalizeWholeNumberInput("1e2", 100)).toBe("12");
    expect(normalizeWholeNumberInput("42 votes", 100)).toBe("42");
  });

  it("clamps values to the field maximum", () => {
    expect(normalizeWholeNumberInput("250", 100)).toBe("100");
  });
});
