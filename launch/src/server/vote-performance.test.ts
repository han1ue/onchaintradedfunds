import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pricesSource = readFileSync(new URL("./prices.ts", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../app/me/page.tsx", import.meta.url), "utf8");

describe("vote performance", () => {
  it("uses each tranche entry checkpoint and weights returns by vote quantity", () => {
    const flow = pricesSource.slice(pricesSource.indexOf("export async function getVoterProposalPerformance"));
    expect(flow).toContain("entry_price.capture_run_id = vt.entry_price_capture_run_id");
    expect(flow).toContain("sum(quantity * return_pct) / sum(quantity)");
    expect(flow).toContain("proposal_status = 'confirmed'");
  });

  it("labels the profile column as vote performance and explains its entry point", () => {
    expect(profileSource).toContain("Vote performance");
    expect(profileSource).toContain("each batch’s entry price checkpoint");
  });
});
