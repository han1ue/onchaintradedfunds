import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);
const { createPublicClient, createWalletClient, getAddress, http } = viem;
const { privateKeyToAccount } = accounts;

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function artifact(source, contract) {
  const path = join(root, "contracts", "out", source, `${contract}.json`);
  if (!existsSync(path)) throw new Error(`Missing fresh artifact: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringify(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const account = privateKeyToAccount(privateKey);
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || process.env.RPC_URL?.trim() || deployment.rpcUrl;
const chain = {
  id: Number(deployment.chainId),
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const factory = getAddress(deployment.contracts.factory.address);
const factoryAbi = artifact("OTFFactory.sol", "OTFFactory").abi;
const vaultAbi = artifact("ManagedOTFVault.sol", "ManagedOTFVault").abi;
const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
];
const historyAbi = [
  {
    type: "function",
    name: "strategyVersionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getStrategyVersion",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "proposedAt", type: "uint64" },
        { name: "activatedAt", type: "uint64" },
        { name: "completedAt", type: "uint64" },
        { name: "author", type: "address" },
        { name: "rationale", type: "string" },
      ],
    }],
  },
  {
    type: "function",
    name: "getStrategyTargets",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "tokens", type: "address[]" }, { name: "weights", type: "uint16[]" }],
  },
];

const samplePools = new Map(
  (deployment.v3Venue?.constituentPools ?? []).map((pool) => [pool.symbol, pool]),
);
const sampleAssets = ["AMD", "TSLA"].map((symbol) => {
  const pool = samplePools.get(symbol);
  if (!pool?.asset) throw new Error(`Missing ${symbol} deployment configuration.`);
  return getAddress(pool.asset);
});
const seedAmount = 1_000_000_000_000_000_000n;
const rationale = "Autonomous Future OTF maintains equal-weight exposure to AMD and Tesla, combining semiconductor infrastructure with real-world AI applications. The portfolio is periodically rebalanced to preserve balanced exposure between computing innovation and autonomous technology.";
const params = {
  name: "Autonomous Future OTF",
  symbol: "OTF-AUTO",
  initialStrategyRationale: rationale,
  manager: account.address,
  feeRecipient: account.address,
  initialAssets: sampleAssets,
  initialTargetWeightsBps: [5_000, 5_000],
  initialAmounts: [seedAmount, seedAmount],
  initialShareSupply: 100_000_000_000_000_000_000n,
  creatorFeeBpsPerYear: 50,
  maxTurnoverBps: 3_000,
  maxNavLossBps: 200,
  maxWeightDeviationBps: 200,
  challengeWeightDeviationBps: 500,
  maxSingleAssetWeightBps: 5_000,
  minNonZeroAssetWeightBps: 100,
  maxAssetCount: 10,
  maxOracleStaleness: 1_800,
  challengeGracePeriod: 5 * 24 * 60 * 60,
};
const existingVaultCount = await publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "vaultCount",
});
if (existingVaultCount > 1n) {
  throw new Error(`New factory contains ${existingVaultCount} vaults; refusing to guess the sample.`);
}

let transactionHash;
let receipt;
if (existingVaultCount === 0n) {
  for (const asset of sampleAssets) {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
      publicClient.readContract({ address: asset, abi: tokenAbi, functionName: "allowance", args: [account.address, factory] }),
    ]);
    if (balance < seedAmount) throw new Error(`Insufficient ${asset} balance for the sample seed.`);
    if (allowance < seedAmount) {
      const approvalHash = await wallet.writeContract({
        address: asset,
        abi: tokenAbi,
        functionName: "approve",
        args: [factory, seedAmount],
        chain,
        account,
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== "success") throw new Error(`Seed approval reverted: ${approvalHash}`);
      console.log(`Approved ${asset}: ${approvalHash}`);
    }
  }
  const { request } = await publicClient.simulateContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createVault",
    args: [params],
    account: account.address,
  });
  transactionHash = await wallet.writeContract({ ...request, account });
  receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error(`Sample creation reverted: ${transactionHash}`);
}
const vault = getAddress(await publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "vaultAt",
  args: [0n],
}));
if (existingVaultCount === 1n) {
  const events = await publicClient.getContractEvents({
    address: factory,
    abi: factoryAbi,
    eventName: "VaultCreated",
    fromBlock: BigInt(deployment.contracts.factory.blockNumber),
  });
  const creation = events.find((event) => event.args.vault?.toLowerCase() === vault.toLowerCase());
  if (!creation?.transactionHash) throw new Error("Could not recover the existing sample creation event.");
  transactionHash = creation.transactionHash;
  receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  console.log(`Using existing sample OTF: ${vault}`);
}

const [cooldown, nextStrategyChangeTime, lastCompleted, versionCount, version, targets] =
  await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "STRATEGY_CHANGE_COOLDOWN" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "nextStrategyChangeTime" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "lastCompletedStrategyTimestamp" }),
    publicClient.readContract({ address: vault, abi: historyAbi, functionName: "strategyVersionCount" }),
    publicClient.readContract({ address: vault, abi: historyAbi, functionName: "getStrategyVersion", args: [0n] }),
    publicClient.readContract({ address: vault, abi: historyAbi, functionName: "getStrategyTargets", args: [0n] }),
  ]);

const cooldownSeconds = BigInt(cooldown);
const nextStrategyChange = BigInt(nextStrategyChangeTime);
const completedBaseline = BigInt(version.completedAt);
if (cooldownSeconds !== 14n * 24n * 60n * 60n) throw new Error("Sample cooldown is not 14 days.");
if (BigInt(versionCount) !== 1n) throw new Error("Initial strategy version was not created.");
if (BigInt(version.proposedAt) !== BigInt(version.activatedAt) || BigInt(version.activatedAt) !== completedBaseline) {
  throw new Error("Initial strategy timestamps do not match deployment completion.");
}
if (BigInt(lastCompleted) !== completedBaseline || nextStrategyChange !== completedBaseline + cooldownSeconds) {
  throw new Error("Initial strategy did not establish the completion-based cooldown baseline.");
}
if (targets[0].length !== 2 || Number(targets[1][0]) !== 5_000 || Number(targets[1][1]) !== 5_000) {
  throw new Error("Initial strategy target snapshot is incorrect.");
}

deployment.sampleVault = {
  address: vault,
  name: params.name,
  symbol: params.symbol,
  transactionHash,
  blockNumber: receipt.blockNumber,
  createdAt: new Date(Number(version.completedAt) * 1_000).toISOString(),
  cooldownSeconds,
  nextStrategyChangeTime: nextStrategyChange,
  initialStrategyVersion: 0,
};
writeFileSync(deploymentPath, `${stringify(deployment)}\n`);
console.log(`Sample OTF: ${vault}`);
console.log(`Creation tx: ${transactionHash}`);
console.log(`Cooldown baseline: ${completedBaseline}; next strategy: ${nextStrategyChange}`);
console.log(`Deployment configuration updated at ${deploymentPath}`);
