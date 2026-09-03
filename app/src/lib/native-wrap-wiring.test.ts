import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8");

describe("native ETH and WETH wrapping", () => {
  it("executes the canonical pair directly without a quote service or Universal Router", () => {
    expect(component).toContain('name: "deposit"');
    expect(component).toContain('name: "withdraw"');
    expect(component).toContain('if (nativeWrapPair)');
    expect(component).toContain('to: configuredWeth.address, data, value');
    expect(component).toContain('input.kind === "native" ? "Wrap ETH" : "Unwrap WETH"');
    expect(component).toContain('"Native wrap · 1:1"');
  });
});
