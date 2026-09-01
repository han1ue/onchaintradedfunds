import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
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

execFileSync(process.execPath, [join(root, "scripts", "compile-contracts.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SOLC_INCLUDE_TESTS: "false" },
});

const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);
const { createPublicClient, createWalletClient, getAddress, http, isAddress, nonceManager } = viem;
const { privateKeyToAccount } = accounts;

const config = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (config.architecture !== "generic-trade-adapter-v1" || config.status !== "deployed") {
  throw new Error("A deployed generic Robinhood Testnet router is required");
}
if (config.contracts?.uniswapV4Adapter?.address) {
  throw new Error("The deployment config already records a UniswapV4Adapter");
}

const env = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env var ${name}`);
  return value.trim();
};
const address = (name, value) => {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
};
const artifact = (name) => {
  const path = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing artifact ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const json = (value) => JSON.stringify(
  value,
  (_key, current) => typeof current === "bigint" ? current.toString() : current,
  2,
);

const account = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY"), { nonceManager });
const chainId = Number(config.chainId);
if (chainId !== 46630) throw new Error(`Expected Robinhood Testnet chain ID 46630, received ${chainId}`);
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || config.rpcUrl;
const entryRouter = address("contracts.entryRouter.address", config.contracts?.entryRouter?.address);
const external = config.externalContracts ?? {};
const poolManager = address("externalContracts.uniswapV4PoolManager", external.uniswapV4PoolManager);
const stateView = address("externalContracts.uniswapV4StateView", external.uniswapV4StateView);
const universalRouter = address(
  "externalContracts.uniswapUniversalRouter",
  external.uniswapUniversalRouter,
);
const permit2 = address("externalContracts.permit2", external.permit2);
const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
if (await publicClient.getChainId() !== chainId) throw new Error("RPC chain ID does not match deployment config");

for (const [name, dependency] of Object.entries({ entryRouter, poolManager, stateView, universalRouter, permit2 })) {
  const code = await publicClient.getCode({ address: dependency });
  if (!code || code === "0x") throw new Error(`${name} has no code on Robinhood Testnet`);
}
const poolManagerAbi = [{
  type: "function",
  name: "poolManager",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}];
for (const [name, dependency] of [["StateView", stateView], ["UniversalRouter", universalRouter]]) {
  const observed = await publicClient.readContract({
    address: dependency,
    abi: poolManagerAbi,
    functionName: "poolManager",
  });
  if (getAddress(observed) !== poolManager) {
    throw new Error(`${name} is bound to ${observed}, not ${poolManager}`);
  }
}

const routerAbi = artifact("OTFEntryExitRouter").abi;
const owner = await publicClient.readContract({ address: entryRouter, abi: routerAbi, functionName: "owner" });
if (getAddress(owner) !== getAddress(account.address)) {
  throw new Error(`Deployer ${account.address} is not the adapter manager ${owner}`);
}

const compiled = artifact("UniswapV4Adapter");
const bytecode = compiled.bytecode.object.startsWith("0x")
  ? compiled.bytecode.object
  : `0x${compiled.bytecode.object}`;
const deploymentHash = await wallet.deployContract({
  abi: compiled.abi,
  bytecode,
  args: [entryRouter, poolManager, stateView, universalRouter, permit2],
  chain,
  account,
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) {
  throw new Error("UniswapV4Adapter deployment reverted");
}
const adapterAddress = getAddress(deploymentReceipt.contractAddress);
const adapterDeployment = {
  address: adapterAddress,
  transactionHash: deploymentHash,
  blockNumber: deploymentReceipt.blockNumber,
  gasUsed: deploymentReceipt.gasUsed,
};

const approvalHash = await wallet.writeContract({
  address: entryRouter,
  abi: routerAbi,
  functionName: "setAdapterApproved",
  args: [adapterAddress, true],
  chain,
  account,
});
const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
if (approvalReceipt.status !== "success") throw new Error("V4 adapter approval reverted");
const approved = await publicClient.readContract({
  address: entryRouter,
  abi: routerAbi,
  functionName: "isAdapterApproved",
  args: [adapterAddress],
});
if (approved !== true) throw new Error("V4 adapter approval was not recorded onchain");
const v4AdapterApproval = {
  transactionHash: approvalHash,
  blockNumber: approvalReceipt.blockNumber,
  gasUsed: approvalReceipt.gasUsed,
};

const approvedAdapters = [...new Set([
  ...(Array.isArray(config.routing?.approvedAdapters) ? config.routing.approvedAdapters : []),
  adapterAddress,
])];
const { adapterApproval, ...otherSetupTransactions } = config.setupTransactions ?? {};
const deployment = {
  ...config,
  deployedAt: new Date().toISOString(),
  contracts: { ...config.contracts, uniswapV4Adapter: adapterDeployment },
  externalContracts: { ...external, uniswapV4PoolManager: poolManager, uniswapV4StateView: stateView, uniswapUniversalRouter: universalRouter, permit2 },
  routing: {
    ...config.routing,
    approvedAdapters,
    uniswapV4Adapter: adapterAddress,
    v4RouteData: "abi.encode((address,uint24,int24,address,bytes)[])",
    maxV4HopsPerLeg: 3,
  },
  setupTransactions: {
    ...otherSetupTransactions,
    v3AdapterApproval: otherSetupTransactions.v3AdapterApproval ?? adapterApproval,
    v4AdapterApproval,
  },
};
writeFileSync(deploymentPath, `${json(deployment)}\n`);
console.log(`UniswapV4Adapter deployed and approved at ${adapterAddress}`);
console.log(`Deployment configuration written to ${deploymentPath}`);
