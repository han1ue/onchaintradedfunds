import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../components/OTFTokenSurface.tsx", import.meta.url), "utf8");
const operate = readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8");
const market = readFileSync(new URL("./otf-market.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("$OTF page wiring", () => {
  it("uses the actual shared Swap surface with a reversible pinned protocol token", () => {
    expect(operate).toContain("export function SwapSurface");
    expect(operate).toContain("<OTFTokenSurface swap={<SwapSurface embedded protocolTokenMode />} />");
    expect(component).toContain("{swap}");
    expect(operate).toContain("const pinnedAsset = protocolTokenMode ? configuredProtocolTokenFor(chainId) : embeddedFund");
    expect(operate).toMatch(/function reverse\(\)[\s\S]*setInput\(output\);[\s\S]*setOutput\(input\);/u);
    expect(operate).toContain('kind: "native"');
    expect(operate).toContain('symbol: "ETH"');
    expect(operate).toContain('asset.symbol.toUpperCase() === "WETH"');
  });

  it("has a simple header and exactly three top metrics", () => {
    expect(component).toContain(">Docs<");
    expect(component).not.toContain("Specification");
    expect(component).not.toContain("ConnectWalletAction");
    const ledger = component.slice(component.indexOf('className="tokenSupplyLedger"'), component.indexOf("<ClaimPanel"));
    for (const label of [">Supply<", ">Price<", ">Market cap<"]) expect(ledger).toContain(label);
    expect(ledger.match(/<div>/g)).toHaveLength(3);
    for (const removed of ["Original supply", "Total burned", "Pool liquidity", "Wallet balance", "FDV"]) expect(ledger).not.toContain(removed);
  });

  it("keeps the compact claim directly above the token swap and off the global Swap route", () => {
    expect(component).toContain("Claim OTF rewards");
    expect(component.indexOf("<ClaimPanel")).toBeLessThan(component.indexOf("tokenSwapLifecycleGrid"));
    expect(component).not.toContain("Merkle rewards");
    expect(operate.indexOf("<ClaimPanel")).toBe(-1);
    expect(component).toContain('aria-live="polite"');
  });

  it("renders four semantic launch phases with a textual current step and no countdown", () => {
    for (const text of ["Not initialized", "Bootstrap active", "Graduation ready", "Graduated"]) expect(component).toContain(text);
    expect(component).toContain('<ol className="launchLifecycle"');
    expect(component).toContain('aria-current={phase === index ? "step" : undefined}');
    expect(component).toContain("Current phase");
    expect(component).toContain("Finalize graduation");
    expect(component).not.toMatch(/estimated graduation|days remaining/iu);
  });

  it("removes vesting and presents the exact fee split without approximation marks", () => {
    expect(component).not.toMatch(/vesting|Merkle rewards/iu);
    expect(component).toContain("$OTF fee split");
    expect(component).not.toContain("rebate");
    expect(market).toContain('creator: "62.64%", buyback: "37.36%"');
    expect(market).toContain('creator: "78.28%", buyback: "21.72%"');
    expect(market).not.toContain("≈");
  });

  it("gives both wallet empty-state descriptions one shared muted style", () => {
    expect(operate).toContain("OTFs will appear here after this wallet creates them through the factory.");
    expect(operate).toContain("Your OTF shares will appear here after a purchase or deposit.");
    expect(css).toContain(".inlineEmptyState > div > span { color: var(--text-muted); font-weight: 400; opacity: 1; }");
    expect(css).not.toMatch(/\.walletPositionEmpty\s+span\s*\{/u);
  });

  it("keeps focus, narrow-layout, and reduced-motion affordances", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
