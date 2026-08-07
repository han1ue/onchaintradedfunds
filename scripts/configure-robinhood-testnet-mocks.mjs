import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  isAddressEqual,
} = viem;
const { privateKeyToAccount } = accounts;

const chainId = 46630;
const rpcUrl = process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const supportedAssetsPath = join(root, "app", "src", "config", "supported-assets.json");
const mockDecimals = 8;
const mockAnswer = 1_00000000n;
const robinhoodEquityMaxStalenessSeconds = 25 * 60 * 60;
const robinhoodStockTokenValidationMode = 1;
const supportedAssets = JSON.parse(readFileSync(supportedAssetsPath, "utf8"));
const catalog = supportedAssets.assets.flatMap((asset) => {
  const deployment = asset.deployments.find((item) => Number(item.chainId) === chainId);
  return deployment ? [{ symbol: asset.symbol, asset: deployment.contractAddress }] : [];
});
if (catalog.length !== supportedAssets.assets.length) {
  throw new Error(`Every supported asset must define a deployment for chain ${chainId}.`);
}

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function artifact(source, contract) {
  const artifactPath = join(root, "contracts", "out", source, `${contract}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}; run "corepack pnpm contracts:solc" first.`);
  }
  return JSON.parse(readFileSync(artifactPath, "utf8"));
}

function serialize(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function saveDeployment(deployment) {
  writeFileSync(deploymentPath, `${serialize(deployment)}\n`);
}

function upsertByAsset(items, record) {
  const index = items.findIndex((item) => isAddressEqual(item.asset, record.asset));
  if (index === -1) items.push(record);
  else items[index] = { ...items[index], ...record };
}

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const account = privateKeyToAccount(privateKey);
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

if (deployment.chainId !== chainId) {
  throw new Error(`Deployment chain ID ${deployment.chainId} does not match ${chainId}.`);
}

const assetRegistry = getAddress(deployment.contracts.assetRegistry.address);
const oracleRegistry = getAddress(deployment.contracts.oracleRegistry.address);
const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

const registryOwnerAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
];
const feedVersionAbi = [
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];
const assetRegistryArtifact = artifact("AssetRegistry.sol", "AssetRegistry");
const oracleRegistryArtifact = artifact("OracleRegistry.sol", "OracleRegistry");
const mockFeedArtifact = artifact("TestnetMockPriceFeed.sol", "TestnetMockPriceFeed");

async function confirmedWrite({ address, abi, functionName, args = [] }) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  const transactionHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${transactionHash}`);
  return {
    transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

async function deployMockFeed(symbol) {
  const transactionHash = await wallet.deployContract({
    abi: mockFeedArtifact.abi,
    bytecode: mockFeedArtifact.bytecode.object,
    args: [account.address, mockDecimals, mockAnswer, `${symbol} Robinhood testnet mock USD`],
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${symbol} mock feed deployment reverted: ${transactionHash}`);
  }
  return {
    address: getAddress(receipt.contractAddress),
    transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId) throw new Error(`RPC returned chain ID ${actualChainId}.`);

const [assetRegistryOwner, oracleRegistryOwner, balance] = await Promise.all([
  publicClient.readContract({ address: assetRegistry, abi: registryOwnerAbi, functionName: "owner" }),
  publicClient.readContract({ address: oracleRegistry, abi: registryOwnerAbi, functionName: "owner" }),
  publicClient.getBalance({ address: account.address }),
]);
if (!isAddressEqual(assetRegistryOwner, account.address)) {
  throw new Error(`Signer ${account.address} does not own AssetRegistry ${assetRegistry}.`);
}
if (!isAddressEqual(oracleRegistryOwner, account.address)) {
  throw new Error(`Signer ${account.address} does not own OracleRegistry ${oracleRegistry}.`);
}
if (balance === 0n) throw new Error("Configurator account has no testnet ETH for gas.");

console.log(`Configurator: ${account.address}`);
console.log(`Balance: ${formatEther(balance)} ETH`);

deployment.oracleMode = "self-updating-testnet-synthetic";
deployment.oracleDisclaimer =
  "Time-derived synthetic USD drift and bounded pseudo-random movement for Robinhood testnet development; predictable and not Chainlink or market data.";
deployment.setupTransactions ??= {};
deployment.setupTransactions.approvedAssets ??= [];
deployment.setupTransactions.priceFeeds ??= [];
deployment.setupTransactions.mockPriceFeeds ??= [];

for (const item of catalog) {
  const asset = getAddress(item.asset);
  const existing = deployment.setupTransactions.mockPriceFeeds.find(
    (record) => isAddressEqual(record.asset, asset),
  );
  let feedDeployment = existing?.feedDeployment;
  let feed = existing?.feed ? getAddress(existing.feed) : undefined;
  const existingCode = feed ? await publicClient.getCode({ address: feed }) : undefined;
  let existingVersion;
  if (feed && existingCode && existingCode !== "0x") {
    try {
      existingVersion = await publicClient.readContract({
        address: feed,
        abi: feedVersionAbi,
        functionName: "version",
      });
    } catch {
      existingVersion = undefined;
    }
  }

  if (!feed || !existingCode || existingCode === "0x" || existingVersion !== 2n) {
    feedDeployment = await deployMockFeed(item.symbol);
    feed = feedDeployment.address;
    console.log(`${item.symbol} self-updating synthetic feed: ${feed}`);
  } else {
    feedDeployment = { ...feedDeployment, address: feed };
    console.log(`${item.symbol} self-updating synthetic feed retained: ${feed}`);
  }

  const approved = await publicClient.readContract({
    address: assetRegistry,
    abi: assetRegistryArtifact.abi,
    functionName: "isApprovedAsset",
    args: [asset],
  });
  const assetApproval = approved
    ? { alreadyConfigured: true }
    : await confirmedWrite({
        address: assetRegistry,
        abi: assetRegistryArtifact.abi,
        functionName: "setAssetApproved",
        args: [asset, true],
      });

  const [configuredFeed, configuredMaxStaleness, configuredValidationMode] = await publicClient.readContract({
    address: oracleRegistry,
    abi: oracleRegistryArtifact.abi,
    functionName: "oracleConfigFor",
    args: [asset],
  });
  const priceFeed = isAddressEqual(configuredFeed, feed)
      && Number(configuredMaxStaleness) === robinhoodEquityMaxStalenessSeconds
      && Number(configuredValidationMode) === robinhoodStockTokenValidationMode
    ? { alreadyConfigured: true }
    : await confirmedWrite({
        address: oracleRegistry,
        abi: oracleRegistryArtifact.abi,
        functionName: "setOracleConfig",
        args: [
          asset,
          feed,
          robinhoodEquityMaxStalenessSeconds,
          robinhoodStockTokenValidationMode,
        ],
      });

  const record = {
    symbol: item.symbol,
    asset,
    feed,
    decimals: mockDecimals,
    baseAnswer: mockAnswer,
    priceEpochSeconds: 300,
    driftBpsPerDay: 5,
    volatilityBps: 50,
    feedDeployment,
    assetApproval,
    priceFeed,
  };
  upsertByAsset(deployment.setupTransactions.mockPriceFeeds, record);
  upsertByAsset(deployment.setupTransactions.approvedAssets, { asset, ...assetApproval });
  upsertByAsset(deployment.setupTransactions.priceFeeds, { asset, feed, ...priceFeed });
  deployment.mockCatalogConfiguredAt = new Date().toISOString();
  saveDeployment(deployment);
}

console.log(`Configured ${catalog.length} mock-priced assets.`);
console.log(`Deployment metadata updated: ${deploymentPath}`);
