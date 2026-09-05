import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { getTestnetRoutingBlock, verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(root, "app/src/config/robinhood-testnet.json"), "utf8"));
const pin = JSON.parse(readFileSync(join(root, "scripts/fixtures/robinhood-testnet-routing.json"), "utf8"));
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const { createPublicClient, http } = appRequire("viem");
const rpcUrl = process.env.TESTNET_RPC_URL || config.rpcUrl;
const client = createPublicClient({ transport: http(rpcUrl) });
const requestedBlock = process.env.TESTNET_FORK_BLOCK ? BigInt(process.env.TESTNET_FORK_BLOCK) : undefined;
const block = await getTestnetRoutingBlock(client, requestedBlock);
const blockNumber = block.number;
if (blockNumber === BigInt(pin.blockNumber) && block.hash !== pin.blockHash) throw new Error("Reference testnet block hash mismatch");
await verifyTestnetRoutingRuntime(client, config, pin, blockNumber);
console.log(`Verified ${Object.keys(pin.dependencies).length} runtimes at block ${blockNumber} (${block.hash}).`);

const windowsForge = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Foundry/v1.7.1/forge.exe");
const forge = process.env.FORGE_BIN || (windowsForge && existsSync(windowsForge) ? windowsForge : "forge");
execFileSync(forge, ["test", "--match-contract", "TestnetRoutingTest", "--rpc-url", rpcUrl,
  "--fork-block-number", String(blockNumber), "--fork-retries", "5", "--fork-retry-backoff", "1000", "--summary"], {
  cwd: join(root, "contracts"),
  stdio: "inherit",
  env: { ...process.env, FOUNDRY_PROFILE: "testnet", TESTNET_FORK_BLOCK: String(blockNumber) },
});
writeFileSync(join(root, "contracts/out/testnet-routing-validation.json"), JSON.stringify({
  chainId: pin.chainId, blockNumber: String(blockNumber), blockHash: block.hash,
  dependencies: pin.dependencies, result: "passed",
}, null, 2) + "\n");
console.log("Testnet routing validation passed. Mainnet dependencies remain unvalidated.");
