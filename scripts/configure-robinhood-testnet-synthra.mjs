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
  zeroAddress,
} = viem;
const { privateKeyToAccount } = accounts;

const chainId = 46630;
const poolFee = 3000;
const oracleMaxAgeSeconds = 3_600n;
const q192 = 1n << 192n;
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const supportedAssetsPath = join(root, "app", "src", "config", "supported-assets.json");
const synthraLiquidityUrl = "https://app.synthra.org/#/pools";
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

function integerSqrt(value) {
  if (value < 0n) throw new Error("Cannot take the square root of a negative value.");
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

function sqrtPriceX96({ asset, settlementToken, assetDecimals, settlementDecimals, answer, feedDecimals }) {
  const assetIsToken0 = BigInt(asset) < BigInt(settlementToken);
  const pricedSettlementNumerator = answer * 10n ** BigInt(settlementDecimals);
  const pricedSettlementDenominator = 10n ** BigInt(feedDecimals);
  const assetAmount = 10n ** BigInt(assetDecimals);
  const ratioNumerator = assetIsToken0
    ? pricedSettlementNumerator
    : pricedSettlementDenominator * assetAmount;
  const ratioDenominator = assetIsToken0
    ? pricedSettlementDenominator * assetAmount
    : pricedSettlementNumerator;
  const result = integerSqrt(ratioNumerator * q192 / ratioDenominator);
  if (result === 0n || result >= 1n << 160n) {
    throw new Error(`Oracle price for ${asset} cannot be represented as sqrtPriceX96.`);
  }
  return result;
}

function upsertByAction(items, action, evidence) {
  const index = items.findIndex((item) => item.action === action);
  const record = { ...(index === -1 ? {} : items[index]), action, ...evidence };
  if (index === -1) items.push(record);
  else items[index] = record;
}

function upsertApprovedAdapter(items, adapter, evidence) {
  const index = items.findIndex((item) => isAddressEqual(item.adapter, adapter));
  const record = { ...(index === -1 ? {} : items[index]), adapter, ...evidence };
  if (index === -1) items.push(record);
  else items[index] = record;
}

const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (Number(deployment.chainId) !== chainId) {
  throw new Error(`Deployment chain ID ${deployment.chainId} does not match ${chainId}.`);
}

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const account = privateKeyToAccount(privateKey);
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || deployment.rpcUrl;
const contracts = deployment.contracts ?? {};
const externalContracts = deployment.externalContracts ?? {};
const factory = getAddress(contracts.factory.address);
const assetRegistry = getAddress(contracts.assetRegistry.address);
const oracleRegistry = getAddress(contracts.oracleRegistry.address);
const rebalanceExecutor = getAddress(contracts.rebalanceExecutor.address);
const settlementToken = getAddress(externalContracts.usdg);
const v3Factory = getAddress(externalContracts.uniswapV3Factory);
const positionManager = getAddress(externalContracts.uniswapV3PositionManager);
const swapRouter = getAddress(externalContracts.uniswapV3SwapRouter);
const quoter = getAddress(externalContracts.uniswapV3Quoter);

const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

const ownerAbi = [{
  type: "function",
  name: "owner",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}];
const erc20MetadataAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const feedAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint80", name: "roundId" },
      { type: "int256", name: "answer" },
      { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" },
      { type: "uint80", name: "answeredInRound" },
    ],
  },
];
const assetRegistryAbi = [{
  type: "function",
  name: "isApprovedAsset",
  stateMutability: "view",
  inputs: [{ type: "address", name: "asset" }],
  outputs: [{ type: "bool" }],
}];
const oracleRegistryAbi = [{
  type: "function",
  name: "priceFeedFor",
  stateMutability: "view",
  inputs: [{ type: "address", name: "asset" }],
  outputs: [{ type: "address" }],
}];
const factoryAbi = [
  ...ownerAbi,
  {
    type: "function",
    name: "isTradeAdapterApproved",
    stateMutability: "view",
    inputs: [{ type: "address", name: "adapter" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setTradeAdapterApproved",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "adapter" }, { type: "bool", name: "approved" }],
    outputs: [],
  },
];
const v3FactoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "feeAmountTickSpacing",
    stateMutability: "view",
    inputs: [{ type: "uint24" }],
    outputs: [{ type: "int24" }],
  },
];
const positionManagerAbi = [{
  type: "function",
  name: "createAndInitializePoolIfNecessary",
  stateMutability: "payable",
  inputs: [
    { type: "address", name: "token0" },
    { type: "address", name: "token1" },
    { type: "uint24", name: "fee" },
    { type: "uint160", name: "sqrtPriceX96" },
  ],
  outputs: [{ type: "address", name: "pool" }],
}];
const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint16", name: "observationIndex" },
      { type: "uint16", name: "observationCardinality" },
      { type: "uint16", name: "observationCardinalityNext" },
      { type: "uint8", name: "feeProtocol" },
      { type: "bool", name: "unlocked" },
    ],
  },
];

const v3AdapterArtifact = artifact("UniswapV3Adapter.sol", "UniswapV3Adapter");
const entryRouterArtifact = artifact("OTFEntryRouter.sol", "OTFEntryRouter");

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
  return { transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

async function deployContract({ artifact: compiled, args }) {
  const transactionHash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args,
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Contract deployment reverted: ${transactionHash}`);
  }
  return {
    address: getAddress(receipt.contractAddress),
    transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

async function requireCode(label, address) {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`${label} has no bytecode at ${address}.`);
}

async function ensureDeployment(name, compiled, args) {
  const existing = contracts[name];
  if (existing?.address) {
    const address = getAddress(existing.address);
    const code = await publicClient.getCode({ address });
    if (code && code !== "0x") return { ...existing, address };
  }
  const deployed = await deployContract({ artifact: compiled, args });
  contracts[name] = deployed;
  saveDeployment(deployment);
  console.log(`${name}: ${deployed.address}`);
  return deployed;
}

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId) throw new Error(`RPC returned chain ID ${actualChainId}.`);
await Promise.all([
  requireCode("Factory", factory),
  requireCode("AssetRegistry", assetRegistry),
  requireCode("OracleRegistry", oracleRegistry),
  requireCode("RebalanceExecutor", rebalanceExecutor),
  requireCode("USDG", settlementToken),
  requireCode("Synthra V3 factory", v3Factory),
  requireCode("Synthra position manager", positionManager),
  requireCode("Synthra swap router", swapRouter),
  requireCode("Synthra quoter", quoter),
]);

const [factoryOwner, balance, settlementDecimals, tickSpacing] = await Promise.all([
  publicClient.readContract({ address: factory, abi: ownerAbi, functionName: "owner" }),
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: settlementToken, abi: erc20MetadataAbi, functionName: "decimals" }),
  publicClient.readContract({ address: v3Factory, abi: v3FactoryAbi, functionName: "feeAmountTickSpacing", args: [poolFee] }),
  publicClient.getBlock(),
]);
if (!isAddressEqual(factoryOwner, account.address)) {
  throw new Error(`Signer ${account.address} does not own factory ${factory}.`);
}
if (balance === 0n) throw new Error("Configurator account has no testnet ETH for gas.");
if (settlementDecimals !== 6) throw new Error(`USDG has ${settlementDecimals} decimals; expected 6.`);
if (tickSpacing <= 0) throw new Error(`Synthra does not support fee tier ${poolFee}.`);

console.log(`Configurator: ${account.address}`);
console.log(`Balance: ${formatEther(balance)} ETH`);

const constituentMarkets = [];
for (const item of catalog) {
  const asset = getAddress(item.asset);
  const [approvedAsset, configuredFeed, assetDecimals] = await Promise.all([
    publicClient.readContract({ address: assetRegistry, abi: assetRegistryAbi, functionName: "isApprovedAsset", args: [asset] }),
    publicClient.readContract({ address: oracleRegistry, abi: oracleRegistryAbi, functionName: "priceFeedFor", args: [asset] }),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "decimals" }),
  ]);
  if (!approvedAsset) throw new Error(`${item.symbol} is not approved in AssetRegistry.`);
  if (isAddressEqual(configuredFeed, zeroAddress)) throw new Error(`${item.symbol} has no configured price feed.`);
  await requireCode(`${item.symbol} price feed`, configuredFeed);

  const [feedDecimals, round] = await Promise.all([
    publicClient.readContract({ address: configuredFeed, abi: feedAbi, functionName: "decimals" }),
    publicClient.readContract({ address: configuredFeed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const oracleBlock = await publicClient.getBlock();
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  if (answer <= 0n || updatedAt === 0n || answeredInRound < roundId) {
    throw new Error(`${item.symbol} returned invalid oracle round data.`);
  }
  if (oracleBlock.timestamp < updatedAt || oracleBlock.timestamp - updatedAt > oracleMaxAgeSeconds) {
    throw new Error(`${item.symbol} oracle data is older than ${oracleMaxAgeSeconds} seconds.`);
  }
  constituentMarkets.push({
    ...item,
    asset,
    assetDecimals,
    configuredFeed,
    feedDecimals,
    answer,
    updatedAt,
    observedAtBlock: oracleBlock.number,
  });
}

const v3Adapter = await ensureDeployment(
  "uniswapV3Adapter",
  v3AdapterArtifact,
  [account.address, swapRouter, settlementToken, poolFee],
);
const entryRouter = await ensureDeployment(
  "entryRouter",
  entryRouterArtifact,
  [account.address, factory, settlementToken],
);

const [adapterOwner, adapterRouter, adapterSettlement, adapterFee, entryOwner, entryFactory, entrySettlement] =
  await Promise.all([
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "owner" }),
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "uniswapRouter" }),
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "settlementToken" }),
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "poolFee" }),
    publicClient.readContract({ address: entryRouter.address, abi: entryRouterArtifact.abi, functionName: "owner" }),
    publicClient.readContract({ address: entryRouter.address, abi: entryRouterArtifact.abi, functionName: "factory" }),
    publicClient.readContract({ address: entryRouter.address, abi: entryRouterArtifact.abi, functionName: "settlementToken" }),
  ]);
if (!isAddressEqual(adapterOwner, account.address) || !isAddressEqual(entryOwner, account.address)) {
  throw new Error("Signer does not own the configured adapter and entry router.");
}
if (
  !isAddressEqual(adapterRouter, swapRouter) || !isAddressEqual(adapterSettlement, settlementToken)
    || adapterFee !== poolFee || !isAddressEqual(entryFactory, factory)
    || !isAddressEqual(entrySettlement, settlementToken)
) throw new Error("Configured adapter or entry router dependencies do not match the deployment JSON.");

deployment.setupTransactions ??= {};
deployment.setupTransactions.approvedAdapters ??= [];
deployment.setupTransactions.settlementEntry ??= [];

let tradeApproved = await publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "isTradeAdapterApproved",
  args: [v3Adapter.address],
});
const tradeApproval = tradeApproved
  ? { alreadyConfigured: true }
  : await confirmedWrite({
      address: factory,
      abi: factoryAbi,
      functionName: "setTradeAdapterApproved",
      args: [v3Adapter.address, true],
    });
upsertApprovedAdapter(deployment.setupTransactions.approvedAdapters, v3Adapter.address, tradeApproval);
upsertByAction(deployment.setupTransactions.settlementEntry, "approve-trade-adapter", tradeApproval);

let entryApproved = await publicClient.readContract({
  address: entryRouter.address,
  abi: entryRouterArtifact.abi,
  functionName: "isEntryAdapterApproved",
  args: [v3Adapter.address],
});
const entryApproval = entryApproved
  ? { alreadyConfigured: true }
  : await confirmedWrite({
      address: entryRouter.address,
      abi: entryRouterArtifact.abi,
      functionName: "setEntryAdapterApproved",
      args: [v3Adapter.address, true],
    });
upsertByAction(deployment.setupTransactions.settlementEntry, "approve-entry-adapter", entryApproval);

for (const [action, caller] of [
  ["authorize-rebalance-executor", rebalanceExecutor],
  ["authorize-entry-router", entryRouter.address],
]) {
  const approved = await publicClient.readContract({
    address: v3Adapter.address,
    abi: v3AdapterArtifact.abi,
    functionName: "isCallerApproved",
    args: [caller],
  });
  const evidence = approved
    ? { alreadyConfigured: true }
    : await confirmedWrite({
        address: v3Adapter.address,
        abi: v3AdapterArtifact.abi,
        functionName: "setCallerApproved",
        args: [caller, true],
      });
  upsertByAction(deployment.setupTransactions.settlementEntry, action, evidence);
}
saveDeployment(deployment);

const poolRecords = [];
for (const item of constituentMarkets) {
  const {
    asset,
    assetDecimals,
    configuredFeed,
    feedDecimals,
    answer,
    updatedAt,
    observedAtBlock,
  } = item;

  const requestedSqrtPriceX96 = sqrtPriceX96({
    asset,
    settlementToken,
    assetDecimals,
    settlementDecimals,
    answer,
    feedDecimals,
  });
  const token0 = BigInt(asset) < BigInt(settlementToken) ? asset : settlementToken;
  const token1 = isAddressEqual(token0, asset) ? settlementToken : asset;
  let pool = await publicClient.readContract({
    address: v3Factory,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: [asset, settlementToken, poolFee],
  });
  let evidence;
  const poolWasMissing = isAddressEqual(pool, zeroAddress);
  const existingSlot0 = poolWasMissing
    ? undefined
    : await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
  if (poolWasMissing || existingSlot0?.[0] === 0n) {
    evidence = await confirmedWrite({
      address: positionManager,
      abi: positionManagerAbi,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, poolFee, requestedSqrtPriceX96],
    });
    pool = await publicClient.readContract({
      address: v3Factory,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [asset, settlementToken, poolFee],
    });
    evidence = {
      ...evidence,
      initialization: poolWasMissing ? "created" : "initialized",
    };
  } else {
    const priorRecord = deployment.v3Venue?.constituentPools?.find(
      (record) => record.symbol === item.symbol && isAddressEqual(record.asset, asset),
    );
    evidence = {
      ...(priorRecord?.transactionHash ? {
        transactionHash: priorRecord.transactionHash,
        blockNumber: priorRecord.blockNumber,
        gasUsed: priorRecord.gasUsed,
        initialization: priorRecord.initialization,
      } : {}),
      alreadyConfigured: true,
      observedAtBlock,
    };
  }
  if (isAddressEqual(pool, zeroAddress)) throw new Error(`${item.symbol}/USDG pool was not created.`);

  const [resolvedToken0, resolvedToken1, resolvedFee, slot0, liquidity] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "fee" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
  ]);
  if (
    !isAddressEqual(resolvedToken0, token0) || !isAddressEqual(resolvedToken1, token1)
      || resolvedFee !== poolFee || slot0[0] === 0n
  ) throw new Error(`${item.symbol}/USDG pool failed post-creation verification.`);

  poolRecords.push({
    symbol: item.symbol,
    asset,
    pool: getAddress(pool),
    fee: poolFee,
    initializedSqrtPriceX96: slot0[0],
    activeLiquidity: liquidity,
    oracleFeed: getAddress(configuredFeed),
    oracleAnswer: answer,
    oracleDecimals: feedDecimals,
    oracleUpdatedAt: updatedAt,
    ...evidence,
  });
  console.log(`${item.symbol}/USDG: ${pool} (${liquidity === 0n ? "awaiting liquidity" : "active"})`);
}

deployment.v3Venue = {
  provider: "synthra",
  liquidityUrl: synthraLiquidityUrl,
  settlementToken,
  constituentFee: poolFee,
  poolInitializationMaxOracleAgeSeconds: Number(oracleMaxAgeSeconds),
  constituentPools: poolRecords,
  configuredAt: new Date().toISOString(),
};
saveDeployment(deployment);
console.log(`Synthra configuration written to ${deploymentPath}`);
