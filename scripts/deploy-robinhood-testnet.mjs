import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { appOwnedIntegrationConfiguration } from "./lib/deployment-config.mjs";

const root = resolve(import.meta.dirname, "..");
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const localEnvPath = join(root, ".env.deploy.local");
if (existsSync(localEnvPath)) {
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2];
    process.env[match[1]] = value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  }
}

// Compile before creating a client; this script never uses stale or deleted artifacts.
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
if (!["superseded-v3-router", "generic-trade-adapter-v1"].includes(config.architecture)) {
  throw new Error("Deployment config has an unsupported source architecture");
}
const appOwnedIntegrations = appOwnedIntegrationConfiguration(config);
const env = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env var ${name}`);
  return value.trim();
};
const address = (name, value) => {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
};
const bps = (name, value) => {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`${name} must be between 0 and 10000`);
  }
  return parsed;
};
const artifact = (name) => {
  const path = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing artifact ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const json = (value) => JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current, 2);

const privateKey = env("DEPLOYER_PRIVATE_KEY");
const treasury = address("TREASURY", env("TREASURY"));
const protocolFeeShareBps = bps("PROTOCOL_FEE_SHARE_BPS", env("PROTOCOL_FEE_SHARE_BPS"));
const account = privateKeyToAccount(privateKey, { nonceManager });
const initialHolder = address("OTF_TOKEN_INITIAL_HOLDER", process.env.OTF_TOKEN_INITIAL_HOLDER?.trim() || treasury);
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || config.rpcUrl || "https://rpc.testnet.chain.robinhood.com";
const chainId = Number(config.chainId ?? 46630);
if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Invalid chain ID ${chainId}`);
const external = config.externalContracts ?? {};
const uniswapV3Factory = address("externalContracts.uniswapV3Factory", external.uniswapV3Factory);
const uniswapV3SwapRouter02 = address(
  "externalContracts.uniswapV3SwapRouter02",
  external.uniswapV3SwapRouter02,
);
const uniswapV4PoolManager = address(
  "externalContracts.uniswapV4PoolManager",
  external.uniswapV4PoolManager,
);
const uniswapV4StateView = address(
  "externalContracts.uniswapV4StateView",
  external.uniswapV4StateView,
);
const uniswapUniversalRouter = address(
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

async function deploy(name, args = []) {
  const compiled = artifact(name);
  const bytecode = compiled.bytecode.object.startsWith("0x") ? compiled.bytecode.object : `0x${compiled.bytecode.object}`;
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode, args, chain, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment reverted`);
  return { address: getAddress(receipt.contractAddress), transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}
async function configureRouter(factory, router) {
  const hash = await wallet.writeContract({
    address: factory.address,
    abi: artifact("OTFFactory").abi,
    functionName: "configureEntryExitRouter",
    args: [router.address],
    chain,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("configureEntryExitRouter reverted");
  return { transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}
async function approveAdapter(router, adapter) {
  const hash = await wallet.writeContract({
    address: router.address,
    abi: artifact("OTFEntryExitRouter").abi,
    functionName: "setAdapterApproved",
    args: [adapter.address, true],
    chain,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("setAdapterApproved reverted");
  return { transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

const vaultImplementation = await deploy("ManagedOTFVault");
const feeCollector = await deploy("FeeCollector", [treasury]);
const otfToken = await deploy("OTFToken", [initialHolder]);
const factory = await deploy("OTFFactory", [
  vaultImplementation.address,
  feeCollector.address,
  protocolFeeShareBps,
]);
const entryRouter = await deploy("OTFEntryExitRouter", [
  factory.address,
  account.address,
]);
const uniswapV3Adapter = await deploy("UniswapV3Adapter", [
  entryRouter.address,
  uniswapV3Factory,
  uniswapV3SwapRouter02,
]);
const uniswapV4Adapter = await deploy("UniswapV4Adapter", [
  entryRouter.address,
  uniswapV4PoolManager,
  uniswapV4StateView,
  uniswapUniversalRouter,
  permit2,
]);
const v3AdapterApproval = await approveAdapter(entryRouter, uniswapV3Adapter);
const v4AdapterApproval = await approveAdapter(entryRouter, uniswapV4Adapter);
const routerConfiguration = await configureRouter(factory, entryRouter);

const deployment = {
  architecture: "generic-trade-adapter-v1",
  network: "robinhood-testnet",
  chainId,
  rpcUrl,
  status: "deployed",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  contracts: {
    feeCollector,
    otfToken,
    vaultImplementation,
    factory,
    entryRouter,
    uniswapV3Adapter,
    uniswapV4Adapter,
  },
  externalContracts: {
    ...external,
    uniswapV3Factory,
    uniswapV3SwapRouter02,
    uniswapV4PoolManager,
    uniswapV4StateView,
    uniswapUniversalRouter,
    permit2,
  },
  policy: { protocolFeeShareBps },
  routing: {
    integration: "approved-trade-adapters",
    approvedAdapters: [uniswapV3Adapter.address, uniswapV4Adapter.address],
    uniswapV3Adapter: uniswapV3Adapter.address,
    uniswapV4Adapter: uniswapV4Adapter.address,
    exactInputTuple: "(bytes,address,uint256,uint256)",
    v4RouteData: "abi.encode((address,uint24,int24,address,bytes)[])",
    maxHopsPerLeg: 3,
    maxLegs: 40,
  },
  setupTransactions: { v3AdapterApproval, v4AdapterApproval, routerConfiguration },
  ...appOwnedIntegrations,
  note: "Creation permanently commits the fund thesis, ordered constituents, and immutable raw bootstrap basket units. Valuation inputs remain application metadata.",
};
mkdirSync(dirname(deploymentPath), { recursive: true });
writeFileSync(deploymentPath, `${json(deployment)}\n`);
console.log(`Deployment configuration written to ${deploymentPath}`);
