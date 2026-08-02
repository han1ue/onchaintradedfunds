import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);

const { createPublicClient, createWalletClient, formatUnits, http } = viem;
const { privateKeyToAccount } = accounts;
const deployment = JSON.parse(
  readFileSync(join(root, "deployments", "robinhood-testnet.json"), "utf8"),
);

const rpcUrl = process.env.RH_TESTNET_RPC_URL || deployment.rpcUrl;
const driftBps = Number(process.env.MOCK_PRICE_DRIFT_BPS || 5);
const volatilityBps = Number(process.env.MOCK_PRICE_VOLATILITY_BPS || 50);
const steps = Number(process.env.MOCK_PRICE_STEPS || 1);
const intervalMs = Number(process.env.MOCK_PRICE_INTERVAL_MS || 0);
const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY)?.trim();

if (!privateKey) throw new Error("Missing DEPLOYER_PRIVATE_KEY or PRIVATE_KEY.");
if (
  !Number.isInteger(driftBps) || driftBps < 0 || driftBps > 10_000
  || !Number.isInteger(volatilityBps) || volatilityBps < 0 || volatilityBps > 9_999
) {
  throw new Error("Drift must be 0-10000 bps and volatility must be 0-9999 bps.");
}
if (!Number.isInteger(steps) || steps < 1 || steps > 10_000) {
  throw new Error("MOCK_PRICE_STEPS must be an integer between 1 and 10000.");
}
if (!Number.isInteger(intervalMs) || intervalMs < 0) {
  throw new Error("MOCK_PRICE_INTERVAL_MS must be a non-negative integer.");
}

const feeds = deployment.setupTransactions?.mockPriceFeeds || [];
if (feeds.length === 0) throw new Error("No mock feeds are recorded in the deployment metadata.");

const account = privateKeyToAccount(privateKey);
const chain = {
  id: deployment.chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint80" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "setAnswer",
    stateMutability: "nonpayable",
    inputs: [{ type: "int256" }],
    outputs: [],
  },
];

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

for (let step = 1; step <= steps; step += 1) {
  for (const feed of feeds) {
    const round = await publicClient.readContract({
      address: feed.feed,
      abi: feedAbi,
      functionName: "latestRoundData",
    });
    const previous = round[1];
    const shockBps = randomInt(-volatilityBps, volatilityBps + 1);
    const movementBps = driftBps + shockBps;
    const next = (previous * BigInt(10_000 + movementBps)) / 10_000n;
    const safeNext = next > 0n ? next : 1n;

    const { request } = await publicClient.simulateContract({
      address: feed.feed,
      abi: feedAbi,
      functionName: "setAnswer",
      args: [safeNext],
      account,
    });
    const transactionHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error(`${feed.symbol} update reverted.`);

    console.log(
      `${feed.symbol}: ${formatUnits(previous, feed.decimals)} -> ${formatUnits(safeNext, feed.decimals)} (${movementBps >= 0 ? "+" : ""}${movementBps} bps)`,
    );
  }
  if (step < steps && intervalMs > 0) await sleep(intervalMs);
}
