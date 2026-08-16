import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compile = spawnSync(process.execPath, [join(root, "scripts", "compile-contracts.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SOLC_INCLUDE_TESTS: "false" },
});
if (compile.status !== 0) {
  throw new Error("Fresh contract compilation failed; deployment was not started.");
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
  isAddress,
  nonceManager,
} = viem;
const { privateKeyToAccount } = accounts;

const defaultRpcUrl = "https://rpc.testnet.chain.robinhood.com";
const defaultChainId = 46630;
const usdQuoteAddress = getAddress("0x0000000000000000000000000000000000000348");
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const deploymentArchiveDirectory = join(root, "app", "src", "config", "deployments");

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

function archiveExistingDeployment() {
  if (!existsSync(deploymentPath)) return undefined;
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  mkdirSync(deploymentArchiveDirectory, { recursive: true });
  const archivePath = join(deploymentArchiveDirectory, `robinhood-testnet-${timestamp}.json`);
  copyFileSync(deploymentPath, archivePath);
  return relative(root, archivePath).replaceAll("\\", "/");
}

async function deployContract({ name, args = [], gas }) {
  const compiled = contractArtifact(name);
  const bytecode = compiled.bytecode.object.startsWith("0x")
    ? compiled.bytecode.object
    : `0x${compiled.bytecode.object}`;
  const hash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode,
    args,
    ...(gas ? { gas } : {}),
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

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const deploymentConfig = JSON.parse(readFileSync(deploymentPath, "utf8"));
const rpcUrl = env("RH_TESTNET_RPC_URL", env("RPC_URL", deploymentConfig.rpcUrl ?? defaultRpcUrl));
const chainId = Number(deploymentConfig.chainId ?? defaultChainId);
const protocolFeeShareBps = Number(deploymentConfig.protocolFeeShareBps ?? 1500);
const account = privateKeyToAccount(privateKey, { nonceManager });
const treasury = parseAddress("treasury", deploymentConfig.treasury ?? account.address);
const trustedOracleRoutes = (
  deploymentConfig.trustedOracleRoutes
    ?? deploymentConfig.protocolConfig?.trustedOracleRoutes
    ?? deploymentConfig.setupTransactions?.trustedOracleRoutes
    ?? []
).map((record, index) => ({
  base: parseAddress(`trustedOracleRoutes[${index}].base`, record.base),
  quote: parseAddress(`trustedOracleRoutes[${index}].quote`, record.quote),
  feed: parseAddress(`trustedOracleRoutes[${index}].feed`, record.feed),
  source: record.source ?? "direct",
  quoteKind: record.quoteKind,
  maxStaleness: Number(record.maxStaleness),
  validationMode: Number(record.validationMode ?? 0),
}));
const externalContracts = deploymentConfig.externalContracts ?? {};
const usdgAddress = parseAddress("externalContracts.usdg", externalContracts.usdg);
const wethAddress = parseAddress("externalContracts.weth", externalContracts.weth);
const wethUsdgPoolAddress = parseAddress(
  "externalContracts.wethUsdgPool",
  externalContracts.wethUsdgPool,
);
const uniswapV3FactoryAddress = parseAddress(
  "externalContracts.uniswapV3Factory",
  externalContracts.uniswapV3Factory,
);
const uniswapV3PositionManagerAddress = parseAddress(
  "externalContracts.uniswapV3PositionManager",
  externalContracts.uniswapV3PositionManager,
);
const uniswapV3SwapRouterAddress = parseAddress(
  "externalContracts.uniswapV3SwapRouter",
  externalContracts.uniswapV3SwapRouter,
);
const uniswapV3QuoterAddress = parseAddress(
  "externalContracts.uniswapV3Quoter",
  externalContracts.uniswapV3Quoter,
);
const trustedRouteKeys = new Set();
for (const [index, route] of trustedOracleRoutes.entries()) {
  if (route.base.toLowerCase() === route.quote.toLowerCase()) {
    throw new Error(`trustedOracleRoutes[${index}] has identical base and quote.`);
  }
  if (!Number.isSafeInteger(route.maxStaleness) || route.maxStaleness <= 0) {
    throw new Error(`trustedOracleRoutes[${index}].maxStaleness must be a positive integer.`);
  }
  if (route.validationMode !== 0 && route.validationMode !== 1) {
    throw new Error(`trustedOracleRoutes[${index}].validationMode must be 0 or 1.`);
  }
  if (route.source !== "direct" && route.source !== "composed") {
    throw new Error(`trustedOracleRoutes[${index}].source must be direct or composed.`);
  }
  const isUsdQuote = route.quote.toLowerCase() === usdQuoteAddress.toLowerCase();
  const isWethQuote = route.quote.toLowerCase() === wethAddress.toLowerCase();
  const isWethUsdLeg = route.base.toLowerCase() === wethAddress.toLowerCase() && isUsdQuote;
  if (
    (route.source === "direct" && !isUsdQuote)
      || (route.source === "composed" && !isWethQuote && !isWethUsdLeg)
  ) {
    throw new Error(`trustedOracleRoutes[${index}] does not match its direct/composed source.`);
  }
  const expectedQuoteKind = isUsdQuote ? "USD" : "WETH";
  if (route.quoteKind && String(route.quoteKind).toUpperCase() !== expectedQuoteKind) {
    throw new Error(`trustedOracleRoutes[${index}].quoteKind does not match quote.`);
  }
  route.quoteKind = expectedQuoteKind;
  const routeKey = `${route.base.toLowerCase()}:${route.quote.toLowerCase()}`;
  if (trustedRouteKeys.has(routeKey)) {
    throw new Error(`trustedOracleRoutes contains duplicate pair ${route.base}/${route.quote}.`);
  }
  trustedRouteKeys.add(routeKey);
}
const wethUsdRoute = trustedOracleRoutes.find(
  (route) => route.base.toLowerCase() === wethAddress.toLowerCase()
    && route.quote.toLowerCase() === usdQuoteAddress.toLowerCase(),
);
const suggestedInitialPricingConfigs = trustedOracleRoutes.flatMap((route) => {
  if (route.source === "direct" && route.quote.toLowerCase() === usdQuoteAddress.toLowerCase()) {
    return [{
      asset: route.base,
      source: "ChainlinkDirect",
      primarySource: route.feed,
      secondarySource: "0x0000000000000000000000000000000000000000",
    }];
  }
  if (
    route.source === "composed" && route.base.toLowerCase() !== wethAddress.toLowerCase()
      && route.quote.toLowerCase() === wethAddress.toLowerCase() && wethUsdRoute
  ) {
    return [{
      asset: route.base,
      source: "ChainlinkAssetWeth",
      primarySource: route.feed,
      secondarySource: wethUsdRoute.feed,
    }];
  }
  return [];
});

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
const portfolioCalculator = await deployContract({ name: "PortfolioCalculator" });
const vaultStrategy = await deployContract({
  name: "ManagedOTFVaultStrategy",
  args: [portfolioCalculator.address],
});
const vaultView = await deployContract({
  name: "ManagedOTFVaultView",
  args: [portfolioCalculator.address],
});
const vaultImplementation = await deployContract({
  name: "ManagedOTFVault",
  args: [portfolioCalculator.address, vaultStrategy.address, vaultView.address],
});
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

const v3MarketRegistry = await deployContract({
  name: "OTFV3MarketRegistry",
  args: [
    factory.address,
    usdgAddress,
    uniswapV3FactoryAddress,
    uniswapV3PositionManagerAddress,
  ],
});

const assetMarketRegistry = await deployContract({
  name: "AssetMarketRegistry",
  args: [
    account.address,
    uniswapV3FactoryAddress,
    wethAddress,
    usdgAddress,
    wethUsdgPoolAddress,
  ],
});
const pricingResolver = await deployContract({
  name: "AssetPricingResolver",
  args: [oracleRegistry.address, assetMarketRegistry.address, portfolioCalculator.address],
});
const registeredUniswapV3AdapterUsdg = await deployContract({
  name: "RegisteredUniswapV3Adapter",
  args: [account.address, uniswapV3SwapRouterAddress, usdgAddress],
});
const registeredUniswapV3AdapterWeth = await deployContract({
  name: "RegisteredUniswapV3Adapter",
  args: [account.address, uniswapV3SwapRouterAddress, wethAddress],
});
const entryRouterUsdg = await deployContract({
  name: "OTFEntryRouter",
  args: [account.address, factory.address, usdgAddress],
});
const entryRouterWeth = await deployContract({
  name: "OTFEntryRouter",
  args: [account.address, factory.address, wethAddress],
});

const rebalanceExecutorAbi = contractArtifact("RebalanceExecutor").abi;
const oracleRegistryAbi = contractArtifact("OracleRegistry").abi;
const factoryAbi = contractArtifact("OTFFactory").abi;
const registeredAdapterAbi = contractArtifact("RegisteredUniswapV3Adapter").abi;
const entryRouterAbi = contractArtifact("OTFEntryRouter").abi;

const setupTransactions = {
  setExecutorFactory: await writeContract({
    address: rebalanceExecutor.address,
    abi: rebalanceExecutorAbi,
    functionName: "setFactory",
    args: [factory.address],
  }),
  discoveredAssets: [],
  trustedOracleRoutes: [],
  approvedAdapters: [],
  settlementEntry: [],
  setOfficialMarketRegistry: await writeContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: "setOfficialMarketRegistry",
    args: [v3MarketRegistry.address],
  }),
  setAssetMarketRegistry: await writeContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: "setAssetMarketRegistry",
    args: [assetMarketRegistry.address],
  }),
  setPricingResolver: await writeContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: "setPricingResolver",
    args: [pricingResolver.address],
  }),
};

for (const [adapter, router, settlement] of [
  [registeredUniswapV3AdapterUsdg, entryRouterUsdg, "USDG"],
  [registeredUniswapV3AdapterWeth, entryRouterWeth, "WETH"],
]) {
  setupTransactions.approvedAdapters.push({
    adapter: adapter.address,
    purpose: `rebalance-${settlement.toLowerCase()}`,
    ...(await writeContract({
      address: factory.address,
      abi: factoryAbi,
      functionName: "setTradeAdapterApproved",
      args: [adapter.address, true],
    })),
  });
  setupTransactions.settlementEntry.push({
    settlement,
    adapter: adapter.address,
    router: router.address,
    rebalanceExecutorCallerApproval: await writeContract({
      address: adapter.address,
      abi: registeredAdapterAbi,
      functionName: "setCallerApproved",
      args: [rebalanceExecutor.address, true],
    }),
    entryRouterCallerApproval: await writeContract({
      address: adapter.address,
      abi: registeredAdapterAbi,
      functionName: "setCallerApproved",
      args: [router.address, true],
    }),
    routerAdapterApproval: await writeContract({
      address: router.address,
      abi: entryRouterAbi,
      functionName: "setEntryAdapterApproved",
      args: [adapter.address, true],
    }),
  });
}

for (const route of trustedOracleRoutes) {
  setupTransactions.trustedOracleRoutes.push({
    ...route,
    ...(await writeContract({
      address: oracleRegistry.address,
      abi: oracleRegistryAbi,
      functionName: "setOracleRoute",
      args: [
        route.base,
        route.quote,
        route.feed,
        route.maxStaleness,
        route.validationMode,
      ],
    })),
  });
}

const archivedDeployment = archiveExistingDeployment();
const deployment = {
  schemaVersion: 3,
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
    portfolioCalculator,
    vaultStrategy,
    vaultView,
    vaultImplementation,
    factory,
    v3MarketRegistry,
    assetMarketRegistry,
    pricingResolver,
    registeredUniswapV3AdapterUsdg,
    registeredUniswapV3AdapterWeth,
    entryRouter: entryRouterUsdg,
    entryRouterWeth,
  },
  externalContracts: {
    usdg: usdgAddress,
    weth: wethAddress,
    wethUsdgPool: wethUsdgPoolAddress,
    uniswapV3Factory: uniswapV3FactoryAddress,
    uniswapV3PositionManager: uniswapV3PositionManagerAddress,
    uniswapV3SwapRouter: uniswapV3SwapRouterAddress,
    uniswapV3Quoter: uniswapV3QuoterAddress,
  },
  v3Venue: {
    provider: "synthra",
    liquidityUrl: "https://app.synthra.org/#/pools",
    settlementToken: usdgAddress,
    constituentFee: 3000,
    poolInitializationMaxOracleAgeSeconds: 3600,
    constituentPools: [],
  },
  pricingConfiguration: {
    sources: ["ChainlinkDirect", "ChainlinkAssetWeth", "UniswapV3Twap"],
    vaultInitField: "initialPricingConfigs",
    trustedOracleRoutes: trustedOracleRoutes.map((route) => ({
      base: route.base,
      quote: route.quote,
      feed: route.feed,
      source: route.source,
      quoteKind: route.quoteKind,
      maxStaleness: route.maxStaleness,
      validationMode: route.validationMode,
    })),
    suggestedInitialPricingConfigs,
    note: "Oracle routes validate a selection only; each vault pins its resolved feed or pool and has no fallback.",
  },
  trustedOracleRoutes: trustedOracleRoutes.map((route) => ({
    base: route.base,
    quote: route.quote,
    quoteKind: route.quoteKind,
    feed: route.feed,
    source: route.source,
    maxStaleness: route.maxStaleness,
    validationMode: route.validationMode,
  })),
  executionRoutes: [
    {
      settlement: "USDG",
      settlementToken: usdgAddress,
      adapter: registeredUniswapV3AdapterUsdg.address,
      entryRouter: entryRouterUsdg.address,
      pathEncoding: "uniswap-v3-packed",
      pricingIndependent: true,
    },
    {
      settlement: "WETH",
      settlementToken: wethAddress,
      adapter: registeredUniswapV3AdapterWeth.address,
      entryRouter: entryRouterWeth.address,
      pathEncoding: "uniswap-v3-packed",
      pricingIndependent: true,
    },
  ],
  migration: {
    architecture: "pinned-pricing-v3",
    legacyFactoriesCompatible: false,
    priorDeploymentArchive: archivedDeployment,
  },
  setupTransactions,
};

mkdirSync(dirname(deploymentPath), { recursive: true });
writeFileSync(deploymentPath, `${deploymentPayload(deployment)}\n`);

console.log(`Deployment and frontend address configuration written to ${deploymentPath}`);
