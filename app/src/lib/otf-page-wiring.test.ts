import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../components/OTFTokenSurface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("$OTF page wiring", () => {
  it("renders every onchain launch phase without inventing a countdown", () => {
    for (const text of ["Pool not initialized", "Bootstrap active", "Graduation ready", "Graduated"]) {
      expect(component).toContain(text);
    }
    expect(component).toContain("Price-driven, with no fixed graduation date.");
    expect(component).toContain("Finalize graduation");
    expect(component).not.toMatch(/countdown|estimated graduation|days remaining/iu);
  });

  it("wires trade, burn, vesting, and cumulative reward states", () => {
    for (const text of [
      "Buy OTF", "Sell OTF", "Max", "Minimum received", "Price impact", "Permit2",
      "Buyback and burn", "does not guarantee price appreciation", "Team market-cap vesting",
      "Cumulative entitlement", "Previously claimed", "Claimable now", "Wallet not included",
    ]) expect(component).toContain(text);
    for (const state of ["approving", "pending", "success", "rejected", "reverted"]) {
      expect(component).toContain(`\"${state}\"`);
    }
  });

  it("keeps keyboard focus and mobile controls accessible", () => {
    expect(component).toContain('role="tablist"');
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('role="alert"');
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("font-size: 16px");
  });
});
