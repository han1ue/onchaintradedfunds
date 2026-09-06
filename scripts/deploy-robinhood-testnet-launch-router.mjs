import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const deploymentPath = join(root, "app/src/config/robinhood-testnet.json");
const journalPath = join(root, "deployments/robinhood-testnet-v3-journal.json");
const budgetPath = join(root, "scripts/fixtures/robinhood-testnet-v3-budget.json");
const localEnvPath = join(root, ".env.deploy.local");

if (existsSync(localEnvPath)) {
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2];
    process.env[match[1]] = value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  }
}

execFileSync(process.execPath, [join(root, "scripts/compile-contracts.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SOLC_INCLUDE_TESTS: "false" },
});

const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);
const {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  getAddress,
  http,
  keccak256,
  nonceManager,
} = viem;
const { privateKeyToAccount } = accounts;
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const artifact = JSON.parse(readFileSync(
  join(root, "contracts/out/OTFLaunchRouter.sol/OTFLaunchRouter.json"),
  "utf8",
));
const bytecode = artifact.bytecode.object.startsWith("0x")
  ? artifact.bytecode.object
  : `0x${artifact.bytecode.object}`;
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};
const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY");
const account = privateKeyToAccount(privateKey, { nonceManager });
const launchManager = getAddress(deployment.contracts.launchManager.address);
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || deployment.rpcUrl;
const chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

if (deployment.chainId !== 46630 || journal.chainId !== 46630 || budget.chainId !== 46630) {
  throw new Error("Launch-router deployment records must target Robinhood testnet chain 46630");
}
if (!budget.authorized) throw new Error("The checked-in testnet gas budget is not authorized");
if (getAddress(deployment.deployer) !== account.address) {
  throw new Error("DEPLOYER_PRIVATE_KEY does not match the configured deployer");
}
if (await publicClient.getChainId() !== 46630) throw new Error("RPC chain ID mismatch");
const launchCode = await publicClient.getCode({ address: launchManager });
if (!launchCode || launchCode === "0x") throw new Error("Configured launch manager has no code");

const managerAbi = [
  { type: "function", name: "otf", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const [otf, weth, poolManager] = await Promise.all(["otf", "weth", "poolManager"].map(
  (functionName) => publicClient.readContract({ address: launchManager, abi: managerAbi, functionName }),
));
for (const [name, observed, expected] of [
  ["OTF", otf, deployment.contracts.otfToken.address],
  ["WETH", weth, deployment.externalContracts.weth],
  ["PoolManager", poolManager, deployment.externalContracts.uniswapV4PoolManager],
]) {
  if (getAddress(observed) !== getAddress(expected)) {
    throw new Error(`Launch manager ${name} binding differs from the canonical deployment`);
  }
}

const data = encodeDeployData({ abi: artifact.abi, bytecode, args: [launchManager] });
const estimatedGas = await publicClient.estimateGas({ account, data });
const gas = estimatedGas * 125n / 100n + 50_000n;
const gasPrice = await publicClient.getGasPrice();
const projectedGasSpend = BigInt(journal.gasSpend) + gas * gasPrice;
if (gasPrice > BigInt(budget.maxGasPriceWei)) throw new Error("Gas price exceeds the authorized cap");
if (projectedGasSpend > BigInt(budget.maxDeploymentGasSpendWei)) {
  throw new Error("Launch-router replacement exceeds the authorized deployment gas cap");
}
const balance = await publicClient.getBalance({ address: account.address });
if (balance < gas * gasPrice) throw new Error("Deployer balance is insufficient for the replacement");

if (process.env.DEPLOYMENT_PREFLIGHT_ONLY === "true") {
  console.log(`Launch-router preflight passed: estimate ${estimatedGas}, limit ${gas}, gas price ${gasPrice}`);
  process.exit(0);
}
if (process.env.DEPLOYMENT_BROADCAST !== "true") {
  throw new Error("Set DEPLOYMENT_BROADCAST=true to deploy the launch router");
}

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode,
  args: [launchManager],
  chain,
  account,
  gas,
  gasPrice,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error("OTFLaunchRouter deployment reverted");
}
const routerAddress = getAddress(receipt.contractAddress);
const routerCode = await publicClient.getCode({ address: routerAddress });
if (!routerCode || routerCode === "0x") throw new Error("Replacement launch router has no code");
const routerRecord = {
  address: routerAddress,
  runtimeCodehash: keccak256(routerCode),
  transactionHash: hash,
  blockNumber: receipt.blockNumber.toString(),
  gasUsed: receipt.gasUsed.toString(),
};
for (const [functionName, expected] of [
  ["launchManager", launchManager],
  ["poolManager", poolManager],
  ["otf", otf],
  ["weth", weth],
]) {
  const observed = await publicClient.readContract({
    address: routerAddress,
    abi: artifact.abi,
    functionName,
  });
  if (getAddress(observed) !== getAddress(expected)) {
    throw new Error(`Replacement launch router ${functionName} binding mismatch`);
  }
}

deployment.contracts.launchRouter = routerRecord;
deployment.routing.launchRouter = routerAddress;
deployment.updatedAt = new Date().toISOString();
journal.transactions.push({
  kind: "deploy",
  name: "OTFLaunchRouter",
  data,
  transactionHash: hash,
  gasUsed: receipt.gasUsed.toString(),
});
journal.totalGas = (BigInt(journal.totalGas) + receipt.gasUsed).toString();
journal.gasSpend = (
  BigInt(journal.gasSpend) + receipt.gasUsed * receipt.effectiveGasPrice
).toString();
writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
console.log(`OTFLaunchRouter deployed at ${routerAddress} in ${hash}`);
