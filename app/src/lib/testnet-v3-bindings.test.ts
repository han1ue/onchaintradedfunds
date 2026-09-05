import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type PublicClient, type Hex } from "viem";
import manifest from "../../../scripts/fixtures/robinhood-testnet-v3.json";
import { testnetAssetById, testnetVenue } from "./asset-catalog";
import { verifyTestnetV3Adapter, verifyTestnetV3Venue } from "./testnet-v3-bindings";

const factory = "0x0000000000000000000000000000000000000011" as const;
const router = "0x0000000000000000000000000000000000000012" as const;
const adapter = "0x0000000000000000000000000000000000000013" as const;
type Reader = Parameters<typeof verifyTestnetV3Venue>[0];

function reader(changed?: string): Reader {
  const runtimes = new Map<string, Hex>();
  for (const dependency of Object.values(manifest.dependencies)) {
    if (!("artifactPath" in dependency)) continue;
    const artifact = JSON.parse(readFileSync(new URL(`../../../${dependency.artifactPath}`, import.meta.url), "utf8"));
    const code = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
    for (const immutable of dependency.immutableSubstitutions) Buffer.from(immutable.value.slice(2), "hex").copy(code, immutable.offset);
    runtimes.set(dependency.address.toLowerCase(), `0x${code.toString("hex")}`);
  }
  // The separate WETH runtime is pinned in the fixture for this test too.
  runtimes.set(testnetVenue.weth9.toLowerCase(), manifest.peripheryWethRuntime as Hex);
  return {
    getChainId: async () => changed === "chain" ? 4663 : 46630,
    getCode: async ({ address }: { address: string }) => changed === "runtime" ? "0x00" : runtimes.get(address.toLowerCase()),
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (changed === `${address.toLowerCase()}:${functionName}`) return factory;
      if (functionName === "isAdapterApproved") return changed !== "approval";
      if (functionName === "entryExitRouter") return router;
      if (functionName === "uniswapV3Factory") return testnetVenue.factory;
      if (functionName === "uniswapV3Router") return testnetVenue.swapRouter02;
      if (functionName === "weth") return testnetAssetById("weth")!.address;
      if (functionName === "WETH9") return testnetVenue.weth9;
      if (functionName === "positionManager") return testnetVenue.positionManager;
      if (functionName === "factory") return address.toLowerCase() === router.toLowerCase() ? factory : testnetVenue.factory;
      throw new Error(`Unexpected read ${functionName}`);
    },
  } as unknown as Pick<PublicClient, "getChainId" | "getCode" | "readContract">;
}

describe("testnet V3 runtime and immutable bindings", () => {
  it("accepts the published artifacts with the distinct periphery WETH", async () => {
    expect(testnetVenue.weth9).not.toBe(testnetAssetById("weth")!.address);
    await expect(verifyTestnetV3Adapter(reader(), factory, router, adapter)).resolves.toBeUndefined();
  });
  it.each(["chain", "runtime", "approval", `${adapter}:entryExitRouter`, `${adapter}:uniswapV3Factory`, `${adapter}:uniswapV3Router`, `${testnetVenue.swapRouter02.toLowerCase()}:factory`, `${testnetVenue.quoter.toLowerCase()}:WETH9`])("rejects a changed %s binding", async (changed) => {
    await expect(verifyTestnetV3Adapter(reader(changed), factory, router, adapter)).rejects.toThrow();
  });
});
