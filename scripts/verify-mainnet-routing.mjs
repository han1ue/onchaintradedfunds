import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { getMainnetRoutingBlockNumber, mainnetRehearsalDependencies, verifyMainnetRoutingRuntime } from "./lib/mainnet-routing.mjs";

const root = resolve(import.meta.dirname, "..");
const pin = JSON.parse(readFileSync(join(root, "scripts/fixtures/robinhood-mainnet-routing.json"), "utf8"));
const rehearsal = JSON.parse(readFileSync(join(root, "scripts/fixtures/robinhood-mainnet-rehearsal.json"), "utf8"));
const mainnet = JSON.parse(readFileSync(join(root, "app/src/config/robinhood-mainnet.json"), "utf8"));
if (mainnet.chainId !== rehearsal.chainId
  || mainnet.externalContracts.ethUsdOracle.toLowerCase() !== rehearsal.oracle.address.toLowerCase()) {
  throw new Error("Mainnet configuration differs from the rehearsed chain or ETH/USD oracle");
}
pin.dependencies = { ...pin.dependencies, ...mainnetRehearsalDependencies(rehearsal) };
const { createPublicClient, http } = createRequire(new URL("../app/package.json", import.meta.url))("viem");
const rpcUrl = process.env.RH_MAINNET_RPC_URL?.trim() || pin.rpcUrl;
const client = createPublicClient({ transport: http(rpcUrl) });
const report = join(root, "contracts/out/mainnet-routing-validation.json");
rmSync(report, { force: true });
const blockNumber = await getMainnetRoutingBlockNumber(client,
  process.env.MAINNET_FORK_BLOCK ? BigInt(process.env.MAINNET_FORK_BLOCK) : undefined);
const block = await verifyMainnetRoutingRuntime(client, pin, blockNumber);
console.log(`Verified ${Object.keys(pin.dependencies).length} mainnet runtimes at block ${blockNumber} (${block.hash}).`);

const windowsForge = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Foundry/v1.7.1/forge.exe");
const forge = process.env.FORGE_BIN || (windowsForge && existsSync(windowsForge) ? windowsForge : "forge");
execFileSync(forge, ["test", "--fork-url", rpcUrl,
  "--fork-block-number", String(blockNumber), "--fork-retries", "5", "--fork-retry-backoff", "1000", "--summary"], {
  cwd: join(root, "contracts"),
  stdio: "inherit",
  env: { ...process.env, FOUNDRY_PROFILE: "mainnet", MAINNET_FORK_BLOCK: String(blockNumber) },
});
mkdirSync(join(root, "contracts/out"), { recursive: true });
writeFileSync(report, JSON.stringify({
  chainId: pin.chainId, blockNumber: String(blockNumber), blockHash: block.hash,
  dependencies: pin.dependencies, result: "passed",
  rehearsal: { accountMode: "funded-local-rehearsal-accounts", oracleMaxAgeSeconds: rehearsal.oracle.maxAgeSeconds,
    stockSymbols: rehearsal.stocks.map((stock) => stock.symbol), productionRolesValidated: false },
}, null, 2) + "\n");
console.log("Mainnet routing validation passed.");
