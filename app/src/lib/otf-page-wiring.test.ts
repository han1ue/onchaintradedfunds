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
    expect(operate).toContain('? "/assets/tokens/eth.png"');
  });

  it("offers native ETH for testnet protocol-token and fund routes", () => {
    expect(operate).toContain("if (canonicalWeth) configured.unshift");
    expect(operate).toContain("configuredDefaultInputFor(chainId)");
    expect(operate).not.toContain('asset.isProtocolToken && counterpart.kind === "native"');
    expect(operate).not.toContain('configuredAssets.filter((asset) => asset.kind !== "native")');
  });

  it("has a simple header and exactly three top metrics", () => {
    expect(component).toContain(">Docs<");
    expect(component).not.toContain("Specification");
    expect(component).not.toContain("ConnectWalletAction");
    const ledgerStart = component.indexOf('className="tokenSupplyLedger"');
    const ledger = component.slice(ledgerStart, component.indexOf("</section>;", ledgerStart));
    for (const label of [">Price<", ">Market cap<", ">Pool<"]) expect(ledger).toContain(label);
    expect(ledger.match(/<div>/g)).toHaveLength(3);
    for (const removed of [">Supply<", "Original supply", "Total burned", "Wallet balance", "FDV"]) expect(ledger).not.toContain(removed);
    expect(component).toContain('testnet ? "/liquidity"');
    expect(component).toContain("robinhoodMainnetLiquidity.baseUrl");
    expect(component).toContain('className="metricExternalLink"');
    expect(css).toContain('.metricExternalLink { display: inline-flex; align-items: center; gap: 5px; color: var(--text);');
  });

  it("keeps the compact claim beside the top metrics and off the global Swap route", () => {
    expect(component).toContain("Available to claim");
    expect(component).not.toContain("Claim rewards");
    expect(component).toContain('className="tokenClaimAmountRow"');
    expect(component).toContain("$OTF");
    expect(component).toContain('artifactState === "empty" ? "0 $OTF"');
    expect(component).toContain('className="tokenTopRow"');
    expect(css).toMatch(/\.tokenClaimAmountRow > strong \{[^}]*font-size: 1rem;/u);
    expect(component.indexOf("<ClaimPanel")).toBeLessThan(component.indexOf("tokenSwapLifecycleGrid"));
    expect(component).not.toContain("Merkle rewards");
    expect(operate.indexOf("<ClaimPanel")).toBe(-1);
    expect(component).toContain('aria-live="polite"');
  });

  it("renders four semantic launch phases with a textual current step and no countdown", () => {
    for (const text of ["Not initialized", "Bootstrap active", "Graduation ready", "Graduated"]) expect(component).toContain(text);
    expect(component).toContain("Exact 20 ETH launch reference valuation.");
    expect(component).toContain("20 ETH to approximately 179.997388091105356396 ETH reference valuation.");
    expect(component).toContain("corrected boundary-aware launch contracts");
    expect(component).toContain("approximately 149,997,417.3963 OTF");
    expect(component).toContain("50 million OTF minus 1,191 raw units");
    expect(component).toContain('functionName: "MAX_SUPPLY"');
    expect(component).not.toContain("const MAX_SUPPLY =");
    expect(component).toContain('<ol className="launchLifecycle"');
    expect(component).toContain('aria-current={phase === index ? "step" : undefined}');
    expect(component).toContain("Current phase");
    expect(component).toContain("Finalize graduation");
    expect(component).not.toContain("launchLifecycleArrow");
    expect(component).not.toMatch(/estimated graduation|days remaining/iu);
  });

  it("routes bootstrap trades through the boundary router with partial-fill disclosure", () => {
    expect(operate).toContain("robinhoodTestnetAddresses.launchRouter");
    expect(operate).toContain('"buyOtfWithEth" | "buyOtfWithWeth" | "sellOtfForWeth"');
    expect(operate).toContain("The launch router will consume only the required input");
    expect(operate).toContain("remains in your wallet");
    expect(operate).toContain("refunded");
  });

  it("removes vesting and presents the exact fee split without approximation marks", () => {
    expect(component).not.toMatch(/vesting|Merkle rewards/iu);
    expect(component).toContain("$OTF fee split");
    expect(component).not.toContain("10m accounted-OTF cap");
    expect(component).not.toContain("Raw OTF donated to a vault does not count toward the split.");
    expect(component).not.toContain("rebate");
    expect(market).toContain('creator: "62.64%", buyback: "37.36%"');
    expect(market).toContain('creator: "78.28%", buyback: "21.72%"');
    expect(market).not.toContain("≈");
  });

  it("gives both wallet empty-state descriptions one shared muted style", () => {
    expect(operate).toContain("OTFs will appear here after this wallet launches them through the factory.");
    expect(operate).toContain("Your OTF shares will appear here after a purchase or deposit.");
    expect(css).toContain(".inlineEmptyState > div > span { color: var(--text-muted); font-weight: 400; opacity: 1; }");
    expect(css).not.toMatch(/\.walletPositionEmpty\s+span\s*\{/u);
  });

  it("uses the shared external-link treatment for the wallet address", () => {
    expect(operate).toContain('className="metricExternalLink walletAddressLink"');
    expect(operate).toContain('className="metricExternalLink fundMetricAddressLink"');
    expect(operate).not.toContain('className="iconOnly compact walletExplorerLink"');
  });

  it("uses the fund header space for metrics and gives the thesis the full hero width", () => {
    const detail = operate.slice(operate.indexOf('className="fundDetailHero"'), operate.indexOf('className="fundDetailPrimaryGrid"'));
    const header = detail.slice(detail.indexOf('className="fundDetailHeader"'));
    expect(header).toContain('className="fundDetailMetrics"');
    expect(detail).toContain('className="fundThesis"');
    expect(css).toContain(".fundDetailHeader { display: grid;");
    expect(css).toContain(".valuationPerformance small { margin-top: 1px;");
  });

  it("keeps focus, narrow-layout, and reduced-motion affordances", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the creation confirmation user-controlled and balances its details", () => {
    const confirmation = operate.slice(operate.indexOf("function CreatedFundSurface"), operate.indexOf("function FundRouteSurface"));
    expect(confirmation).not.toContain("window.location.replace");
    expect(confirmation).not.toContain("redirectSeconds");
    expect(confirmation).not.toContain("The launch transaction is confirmed on Robinhood Testnet.");
    expect(confirmation).toContain("Deposits are opening and fees will start accruing to the selected address.");
    expect(confirmation).toContain(">View OTF<");
    expect(confirmation.match(/className="createdDetailGroup"/gu)).toHaveLength(2);
  });
});
