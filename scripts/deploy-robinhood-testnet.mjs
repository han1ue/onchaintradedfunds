import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const robinhoodEquityMaxStalenessSeconds = 25 * 60 * 60;
const standardChainlinkValidationMode = 0;
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
const approvedAssets = (deploymentConfig.setupTransactions?.approvedAssets ?? []).map((record) =>
  parseAddress("approved asset", record.asset),
);
const feedsByAsset = new Map(
  (deploymentConfig.setupTransactions?.priceFeeds ?? []).map((record) => [
    parseAddress("price-feed asset", record.asset).toLowerCase(),
    parseAddress("price feed", record.feed),
  ]),
);
const priceFeeds = approvedAssets.map((asset) => feedsByAsset.get(asset.toLowerCase()));
const externalContracts = deploymentConfig.externalContracts ?? {};
const usdgAddress = parseAddress("externalContracts.usdg", externalContracts.usdg);
const deployPermissionlessV2 = process.argv.includes("--permissionless-v2")
  || env("DEPLOY_PERMISSIONLESS_V2", "false").toLowerCase() === "true";
const wethAddress = deployPermissionlessV2
  ? parseAddress("externalContracts.weth", externalContracts.weth)
  : undefined;
const wethUsdgPoolAddress = deployPermissionlessV2
  ? parseAddress("externalContracts.wethUsdgPool", externalContracts.wethUsdgPool)
  : undefined;
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
const allowEmptyProtocolConfig = env("ALLOW_EMPTY_PROTOCOL_CONFIG", "false").toLowerCase() === "true";

if (priceFeeds.some((feed) => !feed)) {
  throw new Error("Every approved asset in the deployment JSON must have a matching price feed.");
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
const portfolioCalculator = await deployContract({ name: "PortfolioCalculator" });
const vaultStrategy = await deployContract({
  name: "ManagedOTFVaultStrategy",
  args: [portfolioCalculator.address],
});
const vaultView = await deployContract({ name: "ManagedOTFVaultView" });
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

const assetMarketRegistry = deployPermissionlessV2 ? await deployContract({
  name: "AssetMarketRegistry",
  args: [
    account.address,
    uniswapV3FactoryAddress,
    wethAddress,
    usdgAddress,
    wethUsdgPoolAddress,
  ],
}) : undefined;
const registeredUniswapV3AdapterUsdg = deployPermissionlessV2 ? await deployContract({
  name: "RegisteredUniswapV3Adapter",
  args: [account.address, uniswapV3SwapRouterAddress, assetMarketRegistry.address, usdgAddress],
}) : undefined;
const registeredUniswapV3AdapterWeth = deployPermissionlessV2 ? await deployContract({
  name: "RegisteredUniswapV3Adapter",
  args: [account.address, uniswapV3SwapRouterAddress, assetMarketRegistry.address, wethAddress],
}) : undefined;
const entryRouterUsdg = deployPermissionlessV2 ? await deployContract({
  name: "OTFEntryRouter",
  args: [account.address, factory.address, usdgAddress],
}) : undefined;
const entryRouterWeth = deployPermissionlessV2 ? await deployContract({
  name: "OTFEntryRouter",
  args: [account.address, factory.address, wethAddress],
}) : undefined;

const rebalanceExecutorAbi = contractArtifact("RebalanceExecutor").abi;
const assetRegistryAbi = contractArtifact("AssetRegistry").abi;
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
  approvedAssets: [],
  priceFeeds: [],
  approvedAdapters: [],
  settlementEntry: [],
  setOfficialMarketRegistry: await writeContract({
    address: factory.address,
    abi: factoryAbi,
    functionName: "setOfficialMarketRegistry",
    args: [v3MarketRegistry.address],
  }),
  ...(assetMarketRegistry ? {
    setAssetMarketRegistry: await writeContract({
      address: factory.address,
      abi: factoryAbi,
      functionName: "setAssetMarketRegistry",
      args: [assetMarketRegistry.address],
    }),
  } : {}),
};

if (deployPermissionlessV2) {
  setupTransactions.approvedAdapters.push(
    {
      adapter: registeredUniswapV3AdapterUsdg.address,
      purpose: "rebalance-usdg",
      ...(await writeContract({
        address: factory.address,
        abi: factoryAbi,
        functionName: "setTradeAdapterApproved",
        args: [registeredUniswapV3AdapterUsdg.address, true],
      })),
    },
  );
  for (const [adapter, router, settlement] of [
    [registeredUniswapV3AdapterUsdg, entryRouterUsdg, "USDG"],
    [registeredUniswapV3AdapterWeth, entryRouterWeth, "WETH"],
  ]) {
    setupTransactions.settlementEntry.push({
      settlement,
      adapter: adapter.address,
      router: router.address,
      adapterCallerApproval: await writeContract({
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
  setupTransactions.approvedAdapters.push({
    adapter: registeredUniswapV3AdapterUsdg.address,
    purpose: "rebalance-executor-caller",
    ...(await writeContract({
      address: registeredUniswapV3AdapterUsdg.address,
      abi: registeredAdapterAbi,
      functionName: "setCallerApproved",
      args: [rebalanceExecutor.address, true],
    })),
  });
}

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
      functionName: "setOracleConfig",
      args: [
        approvedAssets[i],
        priceFeeds[i],
        robinhoodEquityMaxStalenessSeconds,
        standardChainlinkValidationMode,
      ],
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
    portfolioCalculator,
    vaultStrategy,
    vaultView,
    vaultImplementation,
    factory,
    ...(v3MarketRegistry ? { v3MarketRegistry } : {}),
    ...(assetMarketRegistry ? { assetMarketRegistry } : {}),
    ...(registeredUniswapV3AdapterUsdg ? { registeredUniswapV3AdapterUsdg } : {}),
    ...(registeredUniswapV3AdapterWeth ? { registeredUniswapV3AdapterWeth } : {}),
    ...(entryRouterUsdg ? { entryRouter: entryRouterUsdg } : {}),
    ...(entryRouterWeth ? { entryRouterWeth } : {}),
  },
  externalContracts: {
    usdg: usdgAddress,
    ...(wethAddress ? { weth: wethAddress } : {}),
    ...(wethUsdgPoolAddress ? { wethUsdgPool: wethUsdgPoolAddress } : {}),
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
  setupTransactions,
};

mkdirSync(dirname(deploymentPath), { recursive: true });
writeFileSync(deploymentPath, `${deploymentPayload(deployment)}\n`);

console.log(`Deployment and frontend address configuration written to ${deploymentPath}`);
