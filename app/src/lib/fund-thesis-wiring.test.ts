import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { readVaultSummary } from "./vault-summary";

describe("onchain fund thesis wiring", () => {
  it("reads the exact contract thesis into the fund summary", async () => {
    const address = getAddress("0x00000000000000000000000000000000000000AA");
    const thesis = "Permanent onchain infrastructure exposure.";
    const values: Record<string, unknown> = {
      name: "Infrastructure OTF",
      symbol: "INFR",
      fundThesis: thesis,
      assets: [getAddress("0x0000000000000000000000000000000000000001")],
      totalSupply: 0n,
      annualCreatorExpenseRatioBps: 100,
      creator: getAddress("0x0000000000000000000000000000000000000002"),
    };
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]);

    const summary = await readVaultSummary({ readContract } as unknown as PublicClient, address);

    expect(summary.fundThesis).toBe(thesis);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "fundThesis" }));
  });

  it("renders the vault value rather than browser creation metadata", () => {
    const source = readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8");
    expect(source).toContain("<p>{vaultDetails.fundThesis}</p>");
    expect(source).not.toContain("creationMetadata.thesis");
  });
});
