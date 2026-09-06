import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("swap receipt wiring", () => {
  it("clears the completed attempt while preserving the selected pair", () => {
    const reset = component.slice(component.indexOf("function backToSwap"), component.indexOf("async function executeSwap"));
    for (const state of ["setAmount(\"\")", "setQuotes([])", "setActiveQuote(undefined)", "setExecution(\"idle\")", "setExecutionMessage(undefined)", "setPreflightMessage(undefined)", "setSwapReceipt(undefined)"]) expect(reset).toContain(state);
    expect(reset).not.toContain("setInput(");
    expect(reset).not.toContain("setOutput(");
  });

  it("focuses the You pay amount field on entry and after leaving a receipt", () => {
    expect(component).toContain("amountInputRef.current?.focus()");
    expect(component).toContain('<input ref={amountInputRef} inputMode="decimal"');
  });

  it("uses a concise ready-state action label", () => {
    expect(component).toContain(': "Swap";');
    expect(component).not.toContain("Review and submit swap");
  });

  it("does not offer a fund-detail action for the protocol token", () => {
    expect(component).toContain("!receipt.fund.isProtocolToken");
  });

  it("caps pay and receive amounts at eight fractional digits", () => {
    expect(component).toContain("const MAX_SWAP_FRACTION_DIGITS = 8;");
    expect(component).toContain("decimalInputValue(event.target.value, Math.min(input.decimals, MAX_SWAP_FRACTION_DIGITS))");
    expect(component).toContain("cappedSwapAmount(usableQuote");
    expect(css).toMatch(/\.swapAmountEntry input,[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/u);
  });

  it("transitions within the card and supplies a reduced-motion path", () => {
    expect(component).toContain("swapCardPane swapFormPane");
    expect(component).toContain("swapCardPane swapReceiptPane");
    expect(css).toContain("@keyframes swapFormExit");
    expect(css).toContain("@keyframes swapReceiptEnter");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.swapConfetti \{ display: none; \}/u);
  });
});
