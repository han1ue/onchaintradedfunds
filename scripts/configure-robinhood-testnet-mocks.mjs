import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnvPath = join(root, ".env.deploy.local");
if (existsSync(localEnvPath)) {
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) continue;
    const rawValue = match[2];
    const quoted = rawValue.length >= 2
      && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'")));
    process.env[match[1]] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}
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
const verifiedAssetsPath = join(root, "app", "src", "config", "verified_assets.json");
const mockDecimals = 8;
const mockAnswer = 1_00000000n;
const robinhoodEquityMaxStalenessSeconds = 25 * 60 * 60;
const verifiedAssets = JSON.parse(readFileSync(verifiedAssetsPath, "utf8"));
const catalog = verifiedAssets
  .filter((asset) => Number(asset.chainId) === chainId)
  .map((asset) => ({
    asset: asset.tokenAddress,
    source: asset.approvedPricingConfigs?.[0]?.source,
    feed: asset.approvedPricingConfigs?.[0]?.feedAddress,
  }));
if (!catalog.length) throw new Error(`No verified assets are configured for chain ${chainId}.`);
for (const item of catalog) {
  if (item.source !== "chainlink" && item.source !== "chainlink-robinhood") {
    throw new Error(`Unsupported mock pricing source for ${item.asset}: ${item.source ?? "missing"}`);
  }
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
  const index = items.findIndex((item) => {
    const itemAsset = item.asset ?? item.base;
    const recordAsset = record.asset ?? record.base;
    return itemAsset && recordAsset && isAddressEqual(itemAsset, recordAsset);
  });
  if (index === -1) items.push(record);
  else items[index] = { ...items[index], ...record };
}

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const account = privateKeyToAccount(privateKey);
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

if (deployment.chainId !== chainId) {
  throw new Error(`Deployment chain ID ${deployment.chainId} does not match ${chainId}.`);
}
if (Number(deployment.schemaVersion) < 7) {
  throw new Error(
    "This configurator requires a fresh permissionless-oracle deployment.",
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

const feedVersionAbi = [
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];
const robinhoodFeedMarkerAbi = [{
  type: "function",
  name: "isRobinhoodPriceFeed",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "bool" }],
}];
const erc20MetadataAbi = [{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "string" }],
}];
const mockFeedArtifact = artifact("TestnetMockPriceFeed.sol", "TestnetMockPriceFeed");
const robinhoodMockFeedArtifact = artifact(
  "TestnetMockRobinhoodPriceFeed.sol",
  "TestnetMockRobinhoodPriceFeed",
);

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

async function deployMockFeed(symbol, source) {
  const isRobinhoodMock = source === "chainlink-robinhood";
  const compiled = isRobinhoodMock ? robinhoodMockFeedArtifact : mockFeedArtifact;
  const description = isRobinhoodMock
    ? `${symbol} Robinhood testnet mock USD`
    : `${symbol} testnet mock USD`;
  const transactionHash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args: [account.address, mockDecimals, mockAnswer, description],
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${symbol} ${source} mock feed deployment reverted: ${transactionHash}`);
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

const balance = await publicClient.getBalance({ address: account.address });
if (balance === 0n) throw new Error("Configurator account has no testnet ETH for gas.");

console.log(`Configurator: ${account.address}`);
console.log(`Balance: ${formatEther(balance)} ETH`);

deployment.oracleMode = "self-updating-testnet-synthetic";
deployment.oracleDisclaimer =
  "Time-derived synthetic USD drift and bounded pseudo-random movement for Robinhood testnet development; predictable, not Chainlink, not canonical, and not market data.";
deployment.setupTransactions ??= {};
deployment.setupTransactions.mockPriceFeeds ??= [];

for (const item of catalog) {
  const asset = getAddress(item.asset);
  const symbol = String(await publicClient.readContract({
    address: asset,
    abi: erc20MetadataAbi,
    functionName: "symbol",
  })).trim() || "TOKEN";
  const existing = deployment.setupTransactions.mockPriceFeeds.find(
    (record) => isAddressEqual(record.asset, asset),
  );
  let feedDeployment = existing?.feedDeployment;
  let feed = existing?.feed
    ? getAddress(existing.feed)
    : item.feed
      ? getAddress(item.feed)
      : undefined;
  const existingCode = feed ? await publicClient.getCode({ address: feed }) : undefined;
  let existingVersion;
  let existingIsRobinhoodMock = false;
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
    try {
      existingIsRobinhoodMock = await publicClient.readContract({
        address: feed,
        abi: robinhoodFeedMarkerAbi,
        functionName: "isRobinhoodPriceFeed",
      });
    } catch {
      existingIsRobinhoodMock = false;
    }
  }

  const expectsRobinhoodMock = item.source === "chainlink-robinhood";
  const mockTypeMatches = expectsRobinhoodMock === existingIsRobinhoodMock;
  if (
    !feed || !existingCode || existingCode === "0x" || existingVersion !== 2n
      || !mockTypeMatches
  ) {
    feedDeployment = await deployMockFeed(symbol, item.source);
    feed = feedDeployment.address;
    console.log(`${symbol} ${item.source} self-updating synthetic feed: ${feed}`);
  } else {
    feedDeployment = { ...feedDeployment, address: feed, retained: true };
    console.log(`${symbol} ${item.source} self-updating synthetic feed retained: ${feed}`);
  }

  const record = {
    symbol,
    asset,
    feed,
    source: item.source,
    mockType: expectsRobinhoodMock
      ? "TestnetMockRobinhoodPriceFeed"
      : "TestnetMockPriceFeed",
    decimals: mockDecimals,
    baseAnswer: mockAnswer,
    priceEpochSeconds: 300,
    driftBpsPerDay: 5,
    volatilityBps: 50,
    feedDeployment,
  };
  upsertByAsset(deployment.setupTransactions.mockPriceFeeds, record);
  deployment.pricingConfiguration ??= {};
  deployment.pricingConfiguration.suggestedInitialPricingConfigs ??= [];
  upsertByAsset(deployment.pricingConfiguration.suggestedInitialPricingConfigs, {
    asset,
    source: item.source,
    quoteToken: "0x0000000000000000000000000000000000000000",
    primarySource: feed,
    primaryMaxStaleness: robinhoodEquityMaxStalenessSeconds,
    synthetic: true,
  });
  const verifiedAsset = verifiedAssets.find(
    (candidate) => Number(candidate.chainId) === chainId
      && isAddressEqual(candidate.tokenAddress, asset),
  );
  if (!verifiedAsset) throw new Error(`Verified asset disappeared during configuration: ${asset}`);
  verifiedAsset.approvedPricingConfigs = [{
    ...verifiedAsset.approvedPricingConfigs[0],
    source: item.source,
    feedAddress: feed,
    maxStaleness: robinhoodEquityMaxStalenessSeconds,
  }];
  deployment.mockCatalogConfiguredAt = new Date().toISOString();
  saveDeployment(deployment);
}

writeFileSync(verifiedAssetsPath, `${serialize(verifiedAssets)}\n`);

console.log(`Configured ${catalog.length} mock-priced assets.`);
console.log(`Deployment metadata updated: ${deploymentPath}`);
console.log(`Verification registry updated: ${verifiedAssetsPath}`);
