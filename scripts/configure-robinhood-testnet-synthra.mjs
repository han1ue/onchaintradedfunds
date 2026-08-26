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
const pricingTwapWindowSeconds = 3_600;
const targetObservationCardinality = 64;
const q192 = 1n << 192n;
const ADAPTER_APPROVAL_TYPE = Object.freeze({
  REBALANCE: 0,
  ENTRY: 1,
  EXIT: 2,
});
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const verifiedAssetsPath = join(root, "app", "src", "config", "verified_assets.json");
const catalog = JSON.parse(readFileSync(verifiedAssetsPath, "utf8"))
  .filter((asset) => Number(asset.chainId) === chainId)
  .map((asset) => ({ asset: asset.tokenAddress }));
if (!catalog.length) throw new Error(`No verified assets are configured for chain ${chainId}.`);

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

function upsertExecutionRoute(items, record) {
  const index = items.findIndex((item) => item.settlement === record.settlement);
  if (index === -1) items.push(record);
  else items[index] = { ...items[index], ...record };
}

const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (Number(deployment.chainId) !== chainId) {
  throw new Error(`Deployment chain ID ${deployment.chainId} does not match ${chainId}.`);
}
if (
  Number(deployment.schemaVersion) < 9
  || deployment.migration?.architecture !== "centralized-adapter-permissions"
) {
  throw new Error(
    "This configurator requires a fresh centralized-adapter-permissions deployment.",
  );
}

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const account = privateKeyToAccount(privateKey, { nonceManager: viem.nonceManager });
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || deployment.rpcUrl;
const contracts = deployment.contracts ?? {};
const externalContracts = deployment.externalContracts ?? {};
const factory = getAddress(contracts.factory.address);
const assetMarketRegistry = getAddress(contracts.assetMarketRegistry.address);
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
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const robinhoodPauseAbi = [
  { type: "function", name: "oraclePaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
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
const factoryAbi = [
  ...ownerAbi,
  {
    type: "function",
    name: "isAdapterApproved",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "adapter" },
      { type: "uint8", name: "approvalType" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setAdapterPermissions",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "adapter" },
      { type: "bool", name: "rebalance" },
      { type: "bool", name: "entry" },
      { type: "bool", name: "exit" },
    ],
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
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
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
  {
    type: "function",
    name: "increaseObservationCardinalityNext",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint16", name: "observationCardinalityNext" }],
    outputs: [],
  },
  {
    type: "function",
    name: "observe",
    stateMutability: "view",
    inputs: [{ type: "uint32[]", name: "secondsAgos" }],
    outputs: [{ type: "int56[]", name: "tickCumulatives" }, { type: "uint160[]", name: "secondsPerLiquidityCumulativeX128s" }],
  },
];

const v3AdapterArtifact = artifact(
  "RegisteredUniswapV3Adapter.sol",
  "RegisteredUniswapV3Adapter",
);
const entryRouterArtifact = artifact("OTFEntryExitRouter.sol", "OTFEntryExitRouter");

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
  return contracts[name];
}

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId) throw new Error(`RPC returned chain ID ${actualChainId}.`);
await Promise.all([
  requireCode("Factory", factory),
  requireCode("Asset pricing market registry", assetMarketRegistry),
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
  const symbol = String(await publicClient.readContract({
    address: asset,
    abi: erc20MetadataAbi,
    functionName: "symbol",
  })).trim() || "TOKEN";
  const pricing = deployment.pricingConfiguration?.suggestedInitialPricingConfigs?.find(
    (candidate) => candidate.asset && isAddressEqual(candidate.asset, asset),
  );
  const configuredFeed = pricing?.primarySource ?? zeroAddress;
  const configuredMaxStaleness = Number(pricing?.primaryMaxStaleness ?? 0);
  const configuredSource = pricing?.source ?? "chainlink";
  const assetDecimals = await publicClient.readContract({
    address: asset,
    abi: erc20MetadataAbi,
    functionName: "decimals",
  });
  if (assetDecimals !== 18) {
    throw new Error(`${symbol} has ${assetDecimals} decimals; mechanically valid OTF assets require exactly 18.`);
  }
  if (isAddressEqual(configuredFeed, zeroAddress)) {
    throw new Error(
      `${symbol} has no suggested direct USD feed for pool initialization. This is an operational seed-price requirement, not asset approval.`,
    );
  }
  if (!Number.isSafeInteger(configuredMaxStaleness)
    || configuredMaxStaleness <= 0
    || configuredMaxStaleness > 7 * 24 * 60 * 60) {
    throw new Error(`${symbol} has an invalid suggested staleness limit.`);
  }
  if (configuredSource !== "chainlink" && configuredSource !== "chainlink-robinhood") {
    throw new Error(`${symbol} needs a direct Chainlink-compatible source for pool initialization.`);
  }
  await requireCode(`${symbol} price feed`, configuredFeed);

  if (configuredSource === "chainlink-robinhood") {
    let oraclePaused;
    try {
      oraclePaused = await publicClient.readContract({
        address: asset,
        abi: robinhoodPauseAbi,
        functionName: "oraclePaused",
      });
    } catch {
      throw new Error(
        `${symbol} uses chainlink-robinhood pricing but oraclePaused() is unavailable.`,
      );
    }
    if (oraclePaused) throw new Error(`${symbol} reports oraclePaused() == true.`);
  }

  const [feedDecimals, round] = await Promise.all([
    publicClient.readContract({ address: configuredFeed, abi: feedAbi, functionName: "decimals" }),
    publicClient.readContract({ address: configuredFeed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const oracleBlock = await publicClient.getBlock();
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = round;
  if (
    roundId === 0n || answer <= 0n || startedAt === 0n || updatedAt === 0n
      || startedAt > updatedAt || answeredInRound < roundId || feedDecimals > 36
  ) {
    throw new Error(`${symbol} returned invalid oracle round data.`);
  }
  if (oracleBlock.timestamp < updatedAt || oracleBlock.timestamp - updatedAt > oracleMaxAgeSeconds) {
    throw new Error(`${symbol} oracle data is older than ${oracleMaxAgeSeconds} seconds.`);
  }
  constituentMarkets.push({
    ...item,
    symbol,
    asset,
    assetDecimals,
    configuredFeed,
    configuredMaxStaleness,
    configuredSource,
    feedDecimals,
    answer,
    updatedAt,
    observedAtBlock: oracleBlock.number,
  });
}

const v3Adapter = await ensureDeployment(
  "uniswapV3Adapter",
  v3AdapterArtifact,
  [account.address, swapRouter],
);
const entryRouter = await ensureDeployment(
  "entryRouter",
  entryRouterArtifact,
  [factory],
);

const [adapterOwner, adapterRouter, entryFactory] =
  await Promise.all([
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "owner" }),
    publicClient.readContract({ address: v3Adapter.address, abi: v3AdapterArtifact.abi, functionName: "uniswapRouter" }),
    publicClient.readContract({ address: entryRouter.address, abi: entryRouterArtifact.abi, functionName: "factory" }),
  ]);
if (!isAddressEqual(adapterOwner, account.address)) {
  throw new Error("Signer does not own the configured adapter.");
}
if (!isAddressEqual(adapterRouter, swapRouter) || !isAddressEqual(entryFactory, factory)) {
  throw new Error("Configured adapter or entry router dependencies do not match the deployment JSON.");
}

deployment.setupTransactions ??= {};
deployment.setupTransactions.approvedAdapters ??= [];
deployment.setupTransactions.settlementEntry ??= [];
deployment.executionRoutes ??= [];
upsertExecutionRoute(deployment.executionRoutes, {
  settlement: "USDG",
  settlementToken,
  adapter: v3Adapter.address,
  entryRouter: entryRouter.address,
  pathEncoding: "uniswap-v3-packed",
  pricingIndependent: true,
});

const adapterPermissions = await Promise.all([
  ADAPTER_APPROVAL_TYPE.REBALANCE,
  ADAPTER_APPROVAL_TYPE.ENTRY,
  ADAPTER_APPROVAL_TYPE.EXIT,
].map((approvalType) => publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "isAdapterApproved",
  args: [v3Adapter.address, approvalType],
})));
const permissionUpdate = adapterPermissions.every(Boolean)
  ? { alreadyConfigured: true }
  : await confirmedWrite({
      address: factory,
      abi: factoryAbi,
      functionName: "setAdapterPermissions",
      args: [v3Adapter.address, true, true, true],
    });
upsertApprovedAdapter(
  deployment.setupTransactions.approvedAdapters,
  v3Adapter.address,
  permissionUpdate,
);
upsertByAction(
  deployment.setupTransactions.settlementEntry,
  "set-adapter-permissions",
  permissionUpdate,
);

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

for (const item of constituentMarkets) {
  const {
    asset,
    assetDecimals,
    feedDecimals,
    answer,
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
  const poolWasMissing = isAddressEqual(pool, zeroAddress);
  const existingSlot0 = poolWasMissing
    ? undefined
    : await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
  if (poolWasMissing || existingSlot0?.[0] === 0n) {
    await confirmedWrite({
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
  }
  if (isAddressEqual(pool, zeroAddress)) throw new Error(`${item.symbol}/USDG pool was not created.`);

  const [resolvedFactory, resolvedToken0, resolvedToken1, resolvedFee, slot0, liquidity] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "factory" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "fee" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
  ]);
  if (
    !isAddressEqual(resolvedFactory, v3Factory)
      || !isAddressEqual(resolvedToken0, token0) || !isAddressEqual(resolvedToken1, token1)
      || resolvedFee !== poolFee || slot0[0] === 0n
  ) throw new Error(`${item.symbol}/USDG pool failed post-creation verification.`);

  if (Number(slot0[4]) < targetObservationCardinality) {
    await confirmedWrite({
      address: pool,
      abi: poolAbi,
      functionName: "increaseObservationCardinalityNext",
      args: [targetObservationCardinality],
    });
  }
  const verifiedSlot0 = await publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "slot0",
  });
  if (Number(verifiedSlot0[4]) < targetObservationCardinality) {
    throw new Error(`${item.symbol}/USDG pool did not accept the required observation capacity.`);
  }
  let twapReady = false;
  try {
    const [tickCumulatives] = await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "observe",
      args: [[pricingTwapWindowSeconds, 0]],
    });
    twapReady = tickCumulatives.length === 2
      && Number(verifiedSlot0[3]) >= targetObservationCardinality;
  } catch {
    twapReady = false;
  }
  console.log(`${item.symbol}/USDG: ${pool} (${liquidity === 0n ? "awaiting liquidity" : "active"})`);
}

delete deployment.v3Venue;
delete deployment.wethV3Venue;
delete deployment.executionLiquidity;
deployment.pricingConfiguration ??= {};
deployment.pricingConfiguration.suggestedV3PricingConfigs = [];
deployment.pricingConfiguration.v3PricingNote =
  "Execution pools are not pricing feeds. A V3 pricing configuration uses the registered quote token's current Chainlink-compatible USD feed and staleness limit.";
saveDeployment(deployment);
console.log(`Synthra configuration written to ${deploymentPath}`);
