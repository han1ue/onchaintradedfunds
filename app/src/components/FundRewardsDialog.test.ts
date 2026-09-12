import React, { type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FundRewardsDialog } from "./FundRewardsDialog";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("document", { body: {} });
});
afterEach(() => vi.unstubAllGlobals());

function render(overrides: Partial<ComponentProps<typeof FundRewardsDialog>> = {}) {
  return renderToStaticMarkup(React.createElement(FundRewardsDialog, {
    fundName: "Capped fund", symbol: "CAP", apyText: "191.7%", hasOtf: true,
    zeroNav: false, loading: false, navUsd: 50_000_000, otfPriceUsd: 2,
    fundWeightOtf: 10_000_000, totalWeightOtf: 25_000_000,
    weeklyDepositorEmissionOtf: 1_300_000, week: 1, onClose: () => {},
    ...overrides,
  }));
}

describe("fund rewards explanation", () => {
  it("shows the fund's share and weekly dollar value in the APY calculation", () => {
    const html = render();
    expect(html).toContain("40%");
    expect(html).toContain("520K");
    expect(html).toContain("$1,040,000.00");
    expect(html).toContain("$50,000,000.00");
    expect(html).toContain("191.7%");
    expect(html).toContain("<sup>52</sup>");
  });

  it("keeps known holdings and reward share when zero NAV makes APY zero", () => {
    const html = render({ zeroNav: true, navUsd: 0, apyText: "0%" });
    expect(html).toContain("40%");
    expect(html).not.toContain("520K");
    expect(html).toContain("Its APY stays at 0%");
    expect(html).not.toContain("No eligible OTF");
    expect(html).not.toContain("<sup>52</sup>");
  });

  it("shows capped weekly amounts and describes the weekly average price", () => {
    const html = render({ navUsd: 5200, apyText: "10,000%" });
    expect(html).toContain("10,000% rewards APY maximum");
    expect(html).toContain("241.31");
    expect(html).toContain("$482.61");
    expect(html).not.toContain("520K");
    expect(html).not.toContain("$1,040,000.00");
    expect(html).toContain("price used for published rewards is a weekly average");
    expect(html).not.toContain("without redistribution or automatic rollover");
    expect(html).not.toContain("without compounding");
    expect(html).not.toContain("Fund holdings, capped");
  });

  it("explains no-OTF eligibility without showing division by zero", () => {
    const html = render({ hasOtf: false, fundWeightOtf: 0, totalWeightOtf: 0, apyText: "0%" });
    expect(html).toContain("does not include the OTF token");
    expect(html).not.toContain("<sup>52</sup>");
    expect(html).not.toMatch(/NaN|Infinity|0 ÷ 0/);
  });

  it("leaves missing balances and prices unavailable", () => {
    const html = render({ apyText: "—", fundWeightOtf: undefined, totalWeightOtf: undefined, navUsd: undefined, otfPriceUsd: undefined });
    expect(html).toContain("Some balances or prices are unavailable");
    expect(html).not.toContain("No eligible OTF means");
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("keeps the error explanation when unavailable APY is displayed as zero", () => {
    const html = render({ apyText: "0%", error: "One or more constituent prices are missing or stale." });
    expect(html).toContain("One or more constituent prices are missing or stale.");
    expect(html).toContain(">0%</strong>");
    expect(html).not.toContain("of the depositor budget before the APY cap");
    expect(html).not.toContain("$1,040,000.00");
  });

  it("keeps a known zero return for a fund without OTF despite unavailable price data", () => {
    const html = render({ hasOtf: false, apyText: "0%", otfPriceUsd: undefined, navUsd: undefined });
    expect(html).toContain(">0%</strong>");
    expect(html).toContain("does not include the OTF token");
    expect(html).not.toContain(">Error</strong>");
  });
});
