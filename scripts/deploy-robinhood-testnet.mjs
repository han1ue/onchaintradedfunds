import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);

const {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
} = viem;
const { privateKeyToAccount } = accounts;

const defaultRpcUrl = "https://rpc.testnet.chain.robinhood.com";
const defaultChainId = 46630;

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function requiredEnv(...names) {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function parseAddress(name, value) {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

function parseAddressList(name) {
  const raw = env(name, "");
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseAddress(name, item));
}

function artifact(source, contract) {
  const path = join(root, "contracts", "out", source, `${contract}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing artifact ${path}; run "corepack pnpm contracts:solc" first.`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function contractArtifact(name) {
  return artifact(`${name}.sol`, name);
}

function deploymentPayload(result) {
  return JSON.stringify(
    result,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

async function deployContract({ name, args = [] }) {
  const compiled = contractArtifact(name);
  const hash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args,
    chain,
    account,
  });
  console.log(`${name} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${name} deployment reverted: ${hash}`);
  console.log(`${name}: ${receipt.contractAddress}`);
  return {
    address: getAddress(receipt.contractAddress),
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

async function writeContract({ address, abi, functionName, args = [] }) {
  const hash = await wallet.writeContract({ address, abi, functionName, args, chain, account });
  console.log(`${functionName} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return { transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

function updateAppEnv(factoryAddress) {
  const appEnvPath = join(root, "app", ".env.local");
  const line = `NEXT_PUBLIC_FACTORY_ADDRESS=${factoryAddress}`;
  let content = existsSync(appEnvPath) ? readFileSync(appEnvPath, "utf8") : "";

  if (/^NEXT_PUBLIC_FACTORY_ADDRESS=/m.test(content)) {
    content = content.replace(/^NEXT_PUBLIC_FACTORY_ADDRESS=.*$/m, line);
  } else {
    content = content.replace(/\s*$/, "");
    content = `${content}${content ? "\n" : ""}${line}\n`;
  }

  writeFileSync(appEnvPath, content);
  return appEnvPath;
}

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const rpcUrl = env("RH_TESTNET_RPC_URL", env("RPC_URL", defaultRpcUrl));
const chainId = Number(env("RH_TESTNET_CHAIN_ID", String(defaultChainId)));
const protocolFeeShareBps = Number(env("PROTOCOL_FEE_SHARE_BPS", "1500"));
const account = privateKeyToAccount(privateKey);
const treasury = parseAddress("TREASURY_ADDRESS", env("TREASURY_ADDRESS", account.address));
const approvedAssets = parseAddressList("APPROVED_ASSETS");
const priceFeeds = parseAddressList("PRICE_FEEDS");
const approvedAdapters = parseAddressList("APPROVED_ADAPTERS");
const allowEmptyProtocolConfig = env("ALLOW_EMPTY_PROTOCOL_CONFIG", "false").toLowerCase() === "true";

if (approvedAssets.length !== priceFeeds.length) {
  throw new Error("APPROVED_ASSETS and PRICE_FEEDS must have the same number of addresses.");
}
if (approvedAssets.length === 0 && !allowEmptyProtocolConfig) {
  throw new Error(
    "APPROVED_ASSETS and PRICE_FEEDS are required for a usable deployment. Set ALLOW_EMPTY_PROTOCOL_CONFIG=true only for an intentionally unconfigured deployment.",
  );
}

const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId) {
  throw new Error(`RPC returned chain ID ${actualChainId}, expected ${chainId}.`);
}

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Deployer: ${account.address}`);
console.log(`Balance: ${formatEther(balance)} ETH`);
if (balance === 0n) {
  throw new Error("Deployer has no testnet ETH for gas.");
}

const assetRegistry = await deployContract({ name: "AssetRegistry", args: [account.address] });
const oracleRegistry = await deployContract({ name: "OracleRegistry", args: [account.address] });
const rebalanceExecutor = await deployContract({
  name: "RebalanceExecutor",
  args: [account.address],
});
const feeCollector = await deployContract({ name: "FeeCollector", args: [treasury] });
const vaultImplementation = await deployContract({ name: "ManagedOTFVault" });
const factory = await deployContract({
  name: "OTFFactory",
  args: [
    vaultImplementation.address,
    feeCollector.address,
    assetRegistry.address,
    oracleRegistry.address,
    rebalanceExecutor.address,
    protocolFeeShareBps,
  ],
});

const rebalanceExecutorAbi = contractArtifact("RebalanceExecutor").abi;
const assetRegistryAbi = contractArtifact("AssetRegistry").abi;
const oracleRegistryAbi = contractArtifact("OracleRegistry").abi;
const factoryAbi = contractArtifact("OTFFactory").abi;

const setupTransactions = {
  setExecutorFactory: await writeContract({
    address: rebalanceExecutor.address,
    abi: rebalanceExecutorAbi,
    functionName: "setFactory",
    args: [factory.address],
  }),
  approvedAssets: [],
  priceFeeds: [],
  approvedAdapters: [],
};

for (const asset of approvedAssets) {
  setupTransactions.approvedAssets.push({
    asset,
    ...(await writeContract({
      address: assetRegistry.address,
      abi: assetRegistryAbi,
      functionName: "setAssetApproved",
      args: [asset, true],
    })),
  });
}

for (let i = 0; i < priceFeeds.length; i += 1) {
  setupTransactions.priceFeeds.push({
    asset: approvedAssets[i],
    feed: priceFeeds[i],
    ...(await writeContract({
      address: oracleRegistry.address,
      abi: oracleRegistryAbi,
      functionName: "setPriceFeed",
      args: [approvedAssets[i], priceFeeds[i]],
    })),
  });
}

for (const adapter of approvedAdapters) {
  setupTransactions.approvedAdapters.push({
    adapter,
    ...(await writeContract({
      address: factory.address,
      abi: factoryAbi,
      functionName: "setTradeAdapterApproved",
      args: [adapter, true],
    })),
  });
}

const deployment = {
  network: "robinhood-testnet",
  chainId,
  rpcUrl,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  treasury,
  protocolFeeShareBps,
  contracts: {
    assetRegistry,
    oracleRegistry,
    rebalanceExecutor,
    feeCollector,
    vaultImplementation,
    factory,
  },
  setupTransactions,
};

const deploymentsDir = join(root, "deployments");
mkdirSync(deploymentsDir, { recursive: true });
const outputPath = join(deploymentsDir, "robinhood-testnet.json");
writeFileSync(outputPath, `${deploymentPayload(deployment)}\n`);
const appEnvPath = updateAppEnv(factory.address);

console.log(`Deployment written to ${outputPath}`);
console.log(`Frontend factory env written to ${appEnvPath}`);
