import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { mainnetPreparation } from "./lib/mainnet-preparation.mjs";
import { getMainnetRoutingBlockNumber, mainnetRehearsalDependencies, verifyMainnetRoutingRuntime } from "./lib/mainnet-routing.mjs";

// This command has no signer, wallet client, private-key loading, or transaction broadcast path.
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const config = read("app/src/config/robinhood-mainnet.json");
const pin = read("scripts/fixtures/robinhood-mainnet-routing.json");
const plan = mainnetPreparation(config, pin, process.env.DEPLOYER_ADDRESS?.trim());
const rehearsal = read("scripts/fixtures/robinhood-mainnet-rehearsal.json");
if (config.externalContracts.ethUsdOracle.toLowerCase() !== rehearsal.oracle.address.toLowerCase()
  || config.externalContracts.uniswapV3Quoter.toLowerCase() !== rehearsal.quoter.address.toLowerCase()
  || config.oracleValidation.maxAgeSeconds !== rehearsal.oracle.maxAgeSeconds) throw new Error("Mainnet oracle or quoter configuration differs from rehearsal");
pin.dependencies = { ...pin.dependencies, ...mainnetRehearsalDependencies(rehearsal) };
const { createPublicClient, http } = createRequire(new URL("../app/package.json", import.meta.url))("viem");
const client = createPublicClient({ transport: http(process.env.RH_MAINNET_RPC_URL?.trim() || config.rpcUrl, { timeout: 12000, retryCount: 0 }) });
const blockNumber = await getMainnetRoutingBlockNumber(client);
const block = await verifyMainnetRoutingRuntime(client, pin, blockNumber);
const directory = join(root, "test-results/mainnet");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "preparation.json"), JSON.stringify({ ...plan, verifiedAt: new Date().toISOString(), blockNumber: String(blockNumber), blockHash: block.hash, externalContracts: config.externalContracts }, null, 2) + "\n");
console.log(`Prepared mainnet configuration at block ${blockNumber}. Broadcasting remains disabled.`);
for (const item of plan.pending) console.log(item);
