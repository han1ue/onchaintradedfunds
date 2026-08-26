import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

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
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");

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
const suggestedInitialPricingConfigs =
  deploymentConfig.pricingConfiguration?.suggestedInitialPricingConfigs ?? [];
const externalContracts = deploymentConfig.externalContracts ?? {};
const usdgAddress = parseAddress("externalContracts.usdg", externalContracts.usdg);
const wethAddress = parseAddress("externalContracts.weth", externalContracts.weth);
const existingQuoteTokens = deploymentConfig.pricingConfiguration?.quoteTokens ?? [];
const existingWethQuote = existingQuoteTokens.find((quote) => quote.symbol === "WETH");
const existingUsdgQuote = existingQuoteTokens.find((quote) => quote.symbol === "USDG");
const configuredWethUsdFeed = env("WETH_USD_FEED_ADDRESS") ?? existingWethQuote?.usdFeed;
const configuredUsdgUsdFeed = env("USDG_USD_FEED_ADDRESS") ?? existingUsdgQuote?.usdFeed;
const quoteUsdMaxStaleness = Number(env("QUOTE_USD_MAX_STALENESS_SECONDS", "3600"));
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

const wethUsdFeed = configuredWethUsdFeed
  ? {
      address: parseAddress("WETH_USD_FEED_ADDRESS", configuredWethUsdFeed),
      retained: true,
      synthetic: Boolean(existingWethQuote?.synthetic),
    }
  : await deployContract({
      name: "TestnetMockPriceFeed",
      args: [account.address, 8, 1_625_00000000n, "Synthetic WETH / USD"],
    });
const usdgUsdFeed = configuredUsdgUsdFeed
  ? {
      address: parseAddress("USDG_USD_FEED_ADDRESS", configuredUsdgUsdFeed),
      retained: true,
      synthetic: Boolean(existingUsdgQuote?.synthetic),
    }
  : await deployContract({
      name: "TestnetMockPriceFeed",
      args: [account.address, 8, 1_00000000n, "Synthetic USDG / USD"],
    });
const wethUsdFeedAddress = wethUsdFeed.address;
const usdgUsdFeedAddress = usdgUsdFeed.address;
const supportedMarketAssets = [
  {
    symbol: "USDG",
    token: usdgAddress,
    usdFeed: usdgUsdFeedAddress,
    feedDeployment: usdgUsdFeed,
  },
  {
    symbol: "WETH",
    token: wethAddress,
    usdFeed: wethUsdFeedAddress,
    feedDeployment: wethUsdFeed,
  },
];

const assetRegistry = await deployContract({ name: "AssetRegistry" });
const rebalanceExecutor = await deployContract({
  name: "RebalanceExecutor",
  args: [account.address],
});
const feeCollector = await deployContract({ name: "FeeCollector", args: [treasury] });
const otfToken = await deployContract({ name: "OTFToken", args: [treasury] });
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
const assetMarketRegistry = await deployContract({
  name: "AssetMarketRegistry",
  args: [account.address, uniswapV3FactoryAddress],
});
const assetMarketRegistryAbi = contractArtifact("AssetMarketRegistry").abi;
const quoteTokenRegistrations = await Promise.all(supportedMarketAssets.map(async (marketAsset) => ({
  symbol: marketAsset.symbol,
  quoteToken: marketAsset.token,
  usdFeed: marketAsset.usdFeed,
  feedDeployment: marketAsset.feedDeployment,
  synthetic: Boolean(marketAsset.feedDeployment.synthetic) || !marketAsset.feedDeployment.retained,
  maxStaleness: quoteUsdMaxStaleness,
  allowComposedChainlink: true,
  allowV3Twap: true,
  ...(await writeContract({
    address: assetMarketRegistry.address,
    abi: assetMarketRegistryAbi,
    functionName: "registerQuoteToken",
    args: [marketAsset.token, marketAsset.usdFeed, quoteUsdMaxStaleness, true, true],
  })),
})));
const pricingResolver = await deployContract({
  name: "AssetPricingResolver",
  args: [assetMarketRegistry.address, portfolioCalculator.address],
});
const factory = await deployContract({
  name: "OTFFactory",
  args: [
    vaultImplementation.address,
    feeCollector.address,
    rebalanceExecutor.address,
    pricingResolver.address,
    protocolFeeShareBps,
  ],
});
const uniswapV3Adapter = await deployContract({
  name: "RegisteredUniswapV3Adapter",
  args: [account.address, uniswapV3SwapRouterAddress],
});
const settlementRoutes = [];
for (const marketAsset of supportedMarketAssets) {
  settlementRoutes.push({
    ...marketAsset,
    router: await deployContract({
      name: "OTFEntryRouter",
      args: [account.address, factory.address, marketAsset.token],
    }),
  });
}
const entryRouteUsdg = settlementRoutes.find((route) => route.symbol === "USDG");
const entryRouteWeth = settlementRoutes.find((route) => route.symbol === "WETH");
if (!entryRouteUsdg || !entryRouteWeth) throw new Error("Supported market routes are incomplete.");

const rebalanceExecutorAbi = contractArtifact("RebalanceExecutor").abi;
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
  approvedAdapters: [{
    adapter: uniswapV3Adapter.address,
    purpose: "generic-rebalance",
    ...(await writeContract({
      address: factory.address,
      abi: factoryAbi,
      functionName: "setTradeAdapterApproved",
      args: [uniswapV3Adapter.address, true],
    })),
  }],
  settlementEntry: [],
  configureProtocolToken: await writeContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: "configureProtocolToken",
    // Permanently identify the testnet token while leaving fee rebates disabled.
    args: [otfToken.address, 0],
  }),
};

for (const route of settlementRoutes) {
  setupTransactions.settlementEntry.push({
    settlement: route.symbol,
    adapter: uniswapV3Adapter.address,
    router: route.router.address,
    entryRouterCallerApproval: await writeContract({
      address: uniswapV3Adapter.address,
      abi: registeredAdapterAbi,
      functionName: "setCallerApproved",
      args: [route.router.address, true],
    }),
    routerAdapterApproval: await writeContract({
      address: route.router.address,
      abi: entryRouterAbi,
      functionName: "setEntryAdapterApproved",
      args: [uniswapV3Adapter.address, true],
    }),
  });
}

setupTransactions.rebalanceExecutorCallerApproval = await writeContract({
  address: uniswapV3Adapter.address,
  abi: registeredAdapterAbi,
  functionName: "setCallerApproved",
  args: [rebalanceExecutor.address, true],
});

const deployment = {
  schemaVersion: 7,
  network: "robinhood-testnet",
  chainId,
  rpcUrl,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  treasury,
  protocolFeeShareBps,
  contracts: {
    assetRegistry,
    rebalanceExecutor,
    feeCollector,
    otfToken,
    portfolioCalculator,
    vaultStrategy,
    vaultView,
    vaultImplementation,
    factory,
    assetMarketRegistry,
    pricingResolver,
    uniswapV3Adapter,
    entryRouter: entryRouteUsdg.router,
    entryRouterWeth: entryRouteWeth.router,
  },
  externalContracts: {
    usdg: usdgAddress,
    weth: wethAddress,
    uniswapV3Factory: uniswapV3FactoryAddress,
    uniswapV3PositionManager: uniswapV3PositionManagerAddress,
    uniswapV3SwapRouter: uniswapV3SwapRouterAddress,
    uniswapV3Quoter: uniswapV3QuoterAddress,
  },
  pricingConfiguration: {
    sources: ["chainlink", "chainlink-composed", "uniswap-v3", "chainlink-robinhood"],
    quoteTokens: quoteTokenRegistrations,
    vaultInitField: "initialPricingConfigs",
    suggestedInitialPricingConfigs,
    maximumOracleStalenessSeconds: 604800,
    note: "Each OTF pins its asset feed or V3 pool. Composed and V3 routes read the quote token's single current USD feed from the admin registry.",
  },
  executionRoutes: settlementRoutes.map((route) => ({
    settlement: route.symbol,
    settlementToken: route.token,
    adapter: uniswapV3Adapter.address,
    entryRouter: route.router.address,
    pathEncoding: "uniswap-v3-packed",
    pricingIndependent: true,
  })),
  migration: {
    architecture: "decoupled-otf-markets",
    legacyFactoriesCompatible: false,
  },
  setupTransactions,
};

mkdirSync(dirname(deploymentPath), { recursive: true });
writeFileSync(deploymentPath, `${deploymentPayload(deployment)}\n`);

console.log(`Deployment and frontend address configuration written to ${deploymentPath}`);
