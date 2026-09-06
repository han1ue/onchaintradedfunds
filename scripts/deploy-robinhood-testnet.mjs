import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { appOwnedIntegrationConfiguration } from "./lib/deployment-config.mjs";
import { testnetOtfSeedConfiguration } from "./lib/testnet-otf-seeds.mjs";
import { assertTestnetDeploymentEncoding, verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";

const root = resolve(import.meta.dirname, "..");
const routingPin = JSON.parse(readFileSync(join(root, "scripts/fixtures/robinhood-testnet-routing.json"), "utf8"));
assertTestnetDeploymentEncoding(routingPin);
const deploymentPath = join(root, "app", "src", "config", "robinhood-testnet.json");
const simulation = process.env.DEPLOYMENT_MODE === "simulate";
const outputPath = simulation ? join(root, "test-results/v3-auth/protocol-simulation.json") : deploymentPath;
const journalPath = join(root, simulation ? "test-results/v3-auth/deployment-simulate-journal.json" : "deployments/robinhood-testnet-v3-journal.json");
if (!simulation && process.env.DEPLOYMENT_PREFLIGHT_ONLY !== "true" && existsSync(journalPath)) {
  throw new Error("A deployment journal already exists; reconcile its transactions before another deployment");
}
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

execFileSync(process.execPath, [join(root, "scripts", "compile-contracts.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SOLC_INCLUDE_TESTS: "false" },
});

const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);
const {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  http,
  isAddress,
  keccak256,
  nonceManager,
  parseAbiParameters,
  toHex,
} = viem;
const { privateKeyToAccount } = accounts;

const previous = JSON.parse(readFileSync(deploymentPath, "utf8"));
const appOwnedIntegrations = appOwnedIntegrationConfiguration(previous);
const env = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env var ${name}`);
  return value.trim();
};
const address = (name, value) => {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
};
const positiveInteger = (name, value) => {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${name} must be positive`);
  return parsed;
};
const bytes32 = (name, value) => {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new Error(`${name} must be bytes32`);
  return value.toLowerCase();
};
const pinnedCodehash = (config, key, envName) => {
  const pinned = bytes32(`expectedCodehashes.${key}`, config?.[key]);
  const confirmed = bytes32(envName, env(envName));
  if (confirmed !== pinned) throw new Error(`${envName} does not match the repository-pinned hash`);
  return pinned;
};
const artifact = (name) => {
  const path = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing artifact ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const bytecode = (name) => {
  const object = artifact(name).bytecode.object;
  return object.startsWith("0x") ? object : `0x${object}`;
};
const json = (value) => JSON.stringify(
  value,
  (_key, current) => typeof current === "bigint" ? current.toString() : current,
  2,
);

const privateKey = env("DEPLOYER_PRIVATE_KEY");
const protocolMultisig = address("PROTOCOL_MULTISIG", env("PROTOCOL_MULTISIG"));
const teamBeneficiary = address("TEAM_BENEFICIARY", env("TEAM_BENEFICIARY"));
const configuredTeamBeneficiary = address(
  "trustedRoles.teamBeneficiary",
  previous.trustedRoles?.teamBeneficiary,
);
if (teamBeneficiary !== configuredTeamBeneficiary) {
  throw new Error("TEAM_BENEFICIARY does not match the repository-configured initial beneficiary");
}
const requestedWeth = address("WETH", env("WETH"));
const oracleMaxAge = positiveInteger("ORACLE_MAX_AGE_SECONDS", env("ORACLE_MAX_AGE_SECONDS"));
const account = privateKeyToAccount(privateKey, { nonceManager });
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim()
  || previous.rpcUrl
  || "https://rpc.testnet.chain.robinhood.com";
const chainId = 46630;
const external = previous.externalContracts ?? {};
const weth = address("externalContracts.weth", external.weth);
if (requestedWeth !== weth) {
  throw new Error("WETH does not match the repository-configured testnet dependency");
}
const uniswapV3Factory = address(
  "externalContracts.uniswapV3Factory",
  external.uniswapV3Factory,
);
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
const uniswapV4Quoter = address(
  "externalContracts.uniswapV4Quoter",
  external.uniswapV4Quoter,
);
const uniswapUniversalRouter = address(
  "externalContracts.uniswapUniversalRouter",
  external.uniswapUniversalRouter,
);
const permit2 = address("externalContracts.permit2", external.permit2);
const uniswapV4PositionManager = address(
  "externalContracts.uniswapV4PositionManager",
  external.uniswapV4PositionManager,
);
const uniswapV4NativeWrapper = address(
  "universalRouterSource.nativeWrapper",
  routingPin.universalRouterSource.nativeWrapper,
);
const requestedV4PositionManager = address(
  "UNISWAP_V4_POSITION_MANAGER",
  env("UNISWAP_V4_POSITION_MANAGER"),
);
if (requestedV4PositionManager !== uniswapV4PositionManager) {
  throw new Error("UNISWAP_V4_POSITION_MANAGER does not match the repository-configured dependency");
}
const pinnedCodehashes = previous.expectedCodehashes ?? {};

const expectedCodehashes = {
  uniswapV4PoolManager: pinnedCodehash(pinnedCodehashes, "uniswapV4PoolManager", "UNISWAP_V4_POOL_MANAGER_CODEHASH"),
  uniswapV4StateView: pinnedCodehash(pinnedCodehashes, "uniswapV4StateView", "UNISWAP_V4_STATE_VIEW_CODEHASH"),
  uniswapV4PositionManager: pinnedCodehash(pinnedCodehashes, "uniswapV4PositionManager", "UNISWAP_V4_POSITION_MANAGER_CODEHASH"),
  uniswapV4Quoter: pinnedCodehash(pinnedCodehashes, "uniswapV4Quoter", "UNISWAP_V4_QUOTER_CODEHASH"),
  uniswapUniversalRouter: pinnedCodehash(pinnedCodehashes, "uniswapUniversalRouter", "UNISWAP_UNIVERSAL_ROUTER_CODEHASH"),
  permit2: pinnedCodehash(pinnedCodehashes, "permit2", "PERMIT2_CODEHASH"),
};

const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const maxDeploymentGas = 33_000_000n;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
if (await publicClient.getChainId() !== chainId) {
  throw new Error("RPC chain ID does not match Robinhood Testnet");
}
if (simulation) {
  if (!["127.0.0.1", "localhost"].includes(new URL(rpcUrl).hostname)
    || !(await publicClient.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) {
    throw new Error("Deployment simulation requires a local Anvil testnet fork");
  }
} else if (process.env.DEPLOYMENT_BROADCAST !== "true" && process.env.DEPLOYMENT_PREFLIGHT_ONLY !== "true") {
  throw new Error("Run DEPLOYMENT_MODE=simulate on a local fork first; live deployment requires DEPLOYMENT_BROADCAST=true");
}

async function verifyCodehash(name, contractAddress, expected) {
  const code = await publicClient.getCode({ address: contractAddress });
  if (!code || code === "0x") throw new Error(`${name} has no code`);
  const actual = keccak256(code).toLowerCase();
  if (actual !== expected) {
    throw new Error(`${name} codehash mismatch: expected ${expected}, received ${actual}`);
  }
  return code;
}

function verifyEmbeddedAddress(name, code, expected) {
  if (!code.toLowerCase().includes(expected.slice(2).toLowerCase())) {
    throw new Error(`${name} does not embed ${expected}`);
  }
}

async function verifyAddressBinding(name, contractAddress, functionName, expected) {
  const observed = await publicClient.readContract({
    address: contractAddress,
    abi: [{
      type: "function",
      name: functionName,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "address" }],
    }],
    functionName,
  });
  if (getAddress(observed) !== expected) {
    throw new Error(`${name} mismatch: expected ${expected}, received ${observed}`);
  }
}

await verifyCodehash("Uniswap V4 PoolManager", uniswapV4PoolManager, expectedCodehashes.uniswapV4PoolManager);
await verifyCodehash("Uniswap V4 StateView", uniswapV4StateView, expectedCodehashes.uniswapV4StateView);
const positionManagerCode = await verifyCodehash("Uniswap V4 PositionManager", uniswapV4PositionManager, expectedCodehashes.uniswapV4PositionManager);
await verifyCodehash("Uniswap V4 Quoter", uniswapV4Quoter, expectedCodehashes.uniswapV4Quoter);
const universalRouterCode = await verifyCodehash("Uniswap Universal Router", uniswapUniversalRouter, expectedCodehashes.uniswapUniversalRouter);
await verifyCodehash("Permit2", permit2, expectedCodehashes.permit2);
await Promise.all([
  verifyAddressBinding("StateView PoolManager", uniswapV4StateView, "poolManager", uniswapV4PoolManager),
  verifyAddressBinding("PositionManager PoolManager", uniswapV4PositionManager, "poolManager", uniswapV4PoolManager),
  verifyAddressBinding("Quoter PoolManager", uniswapV4Quoter, "poolManager", uniswapV4PoolManager),
  verifyAddressBinding("Universal Router PoolManager", uniswapUniversalRouter, "poolManager", uniswapV4PoolManager),
  verifyAddressBinding("Universal Router PositionManager", uniswapUniversalRouter, "V4_POSITION_MANAGER", uniswapV4PositionManager),
]);
verifyEmbeddedAddress("PositionManager native wrapper", positionManagerCode, uniswapV4NativeWrapper);
verifyEmbeddedAddress("PositionManager Permit2", positionManagerCode, permit2);
verifyEmbeddedAddress("Universal Router native wrapper", universalRouterCode, uniswapV4NativeWrapper);
verifyEmbeddedAddress("Universal Router Permit2", universalRouterCode, permit2);

await verifyTestnetRoutingRuntime(publicClient, previous, routingPin);

const assetCatalog = JSON.parse(readFileSync(join(root, "app/src/config/robinhood-testnet-assets.json"), "utf8"));
for (const pool of assetCatalog.pools) {
  const liquidity = await publicClient.readContract({ address: pool.address,
    abi: [{ type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }], functionName: "liquidity" });
  if (liquidity === 0n) throw new Error(`Seed ${pool.id} before switching the protocol`);
}

if (process.env.DEPLOYMENT_PREFLIGHT_ONLY === "true") {
  const deployerBalance = await publicClient.getBalance({ address: account.address });
  const gasPrice = await publicClient.getGasPrice();
  const minimumBalance = maxDeploymentGas * gasPrice;
  if (deployerBalance < minimumBalance) {
    throw new Error(`Deployer needs at least ${minimumBalance} wei at the current gas price`);
  }
  console.log(
    `Deployment preflight passed for ${account.address} with ${deployerBalance} wei at ${gasPrice} wei/gas`,
  );
  process.exit(0);
}

let totalGas = 0n;
let gasSpend = 0n;
const transactions = [];
const saveJournal = () => {
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, json({ chainId, simulation, transactions, totalGas, gasSpend }) + "\n");
};
const fundingBudget = !simulation && process.env.LIQUIDITY_BUDGET_FILE
  ? JSON.parse(readFileSync(resolve(root, process.env.LIQUIDITY_BUDGET_FILE), "utf8")) : undefined;
if (!simulation && (!fundingBudget || fundingBudget.chainId !== 46630 || fundingBudget.authorized !== true)) {
  throw new Error("An explicitly authorized testnet funding budget is required for the fresh deployment");
}
const transactionGasPrice = async () => simulation
  ? BigInt(JSON.parse(readFileSync(join(root, "scripts/fixtures/robinhood-testnet-v3.json"), "utf8")).gasPriceWei)
  : publicClient.getGasPrice();
async function reserveGas(gas) {
  if (totalGas + gas > maxDeploymentGas) throw new Error("Deployment exceeds the 33,000,000 gas budget");
  const gasPrice = await transactionGasPrice();
  if (fundingBudget && (gasPrice > BigInt(fundingBudget.maxGasPriceWei) || gasSpend + gas * gasPrice > BigInt(fundingBudget.maxDeploymentGasSpendWei))) throw new Error("Deployment exceeds the authorized gas budget");
  return gasPrice;
}
async function deploy(name, args = []) {
  const compiled = artifact(name);
  const data = viem.encodeDeployData({ abi: compiled.abi, bytecode: bytecode(name), args });
  const estimatedGas = await publicClient.estimateGas({ account, data });
  const gas = estimatedGas * 125n / 100n + 50_000n;
  const gasPrice = await reserveGas(gas);
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: bytecode(name), args, chain, account, gas, gasPrice });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${name} deployment reverted`);
  }
  totalGas += receipt.gasUsed;
  gasSpend += receipt.gasUsed * receipt.effectiveGasPrice;
  transactions.push({ kind: "deploy", name, data, transactionHash: hash, gasUsed: receipt.gasUsed });
  saveJournal();
  return {
    address: getAddress(receipt.contractAddress),
    runtimeCodehash: keccak256(await publicClient.getCode({ address: receipt.contractAddress })),
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

async function transact(contract, functionName, args = []) {
  await publicClient.simulateContract({ address: contract.address, abi: artifact(contract.name).abi, functionName, args, account });
  const gas = (await publicClient.estimateContractGas({ address: contract.address, abi: artifact(contract.name).abi, functionName, args, account })) * 125n / 100n + 50_000n;
  const gasPrice = await reserveGas(gas);
  const hash = await wallet.writeContract({
    address: contract.address,
    abi: artifact(contract.name).abi,
    functionName,
    args,
    chain,
    account,
    gas,
    gasPrice,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${contract.name}.${functionName} reverted`);
  totalGas += receipt.gasUsed;
  gasSpend += receipt.gasUsed * receipt.effectiveGasPrice;
  transactions.push({ kind: "call", name: contract.name, functionName, to: contract.address,
    data: viem.encodeFunctionData({ abi: artifact(contract.name).abi, functionName, args }), transactionHash: hash, gasUsed: receipt.gasUsed });
  saveJournal();
  return { transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

const otfToken = await deploy("OTFToken", [account.address]);
const fakeEthUsdOracle = await deploy("FakeETHUSDOracle");
const launchManagerDeployer = await deploy("OTFLaunchManagerDeployer");
const launchConstructorArgs = [
  otfToken.address,
  weth,
  uniswapV4PoolManager,
  uniswapV4StateView,
  uniswapV4PositionManager,
  permit2,
];
const encodedConstructorArgs = encodeAbiParameters(
  parseAbiParameters("address,address,address,address,address,address"),
  launchConstructorArgs,
);
const launchInitCodeHash = keccak256(concatHex([bytecode("OTFLaunchManager"), encodedConstructorArgs]));
const allHookFlags = 0x3fffn;
const requiredLaunchHookFlags = 0x2840n;
let launchSalt;
let launchAddress;
for (let candidate = 0n; candidate < 1_000_000n; candidate++) {
  const salt = toHex(candidate, { size: 32 });
  const predicted = getCreate2Address({
    from: launchManagerDeployer.address,
    salt,
    bytecodeHash: launchInitCodeHash,
  });
  if ((BigInt(predicted) & allHookFlags) === requiredLaunchHookFlags) {
    launchSalt = salt;
    launchAddress = getAddress(predicted);
    break;
  }
}
if (!launchSalt || !launchAddress) {
  throw new Error("Could not mine beforeInitialize + beforeAddLiquidity + afterSwap hook address with mask 0x2840");
}
if ((BigInt(launchAddress) & allHookFlags) !== requiredLaunchHookFlags) {
  throw new Error("Mined launch-manager hook address does not have the exact 0x2840 mask");
}
const launchDeploymentTx = await transact(
  { ...launchManagerDeployer, name: "OTFLaunchManagerDeployer" },
  "deploy",
  [launchSalt, ...launchConstructorArgs],
);
const launchManager = { address: launchAddress, ...launchDeploymentTx, salt: launchSalt };
const readLaunch = (functionName) => publicClient.readContract({
  address: launchManager.address,
  abi: artifact("OTFLaunchManager").abi,
  functionName,
});
if (!await readLaunch("hookPermissionsValid")) {
  throw new Error("Deployed launch manager rejects its hook permissions");
}
const [
  maxBootstrapBudget,
  permanentOtfCap,
  requiredLaunchBalance,
  bootstrapLiquidity,
  permanentLiquidity,
  poolFee,
  tickSpacing,
  otfIsCurrency0,
  initialTick,
  finalTick,
  initialSqrtPriceX96,
  finalSqrtPriceX96,
  initialOtfPriceWethWad,
  finalOtfPriceWethWad,
  poolId,
  bootstrapSqrtPriceBounds,
  derivedLaunchAmounts,
] = await Promise.all([
  readLaunch("MAX_BOOTSTRAP_BUDGET"),
  readLaunch("PERMANENT_OTF_CAP"),
  readLaunch("REQUIRED_OTF_BALANCE"),
  readLaunch("BOOTSTRAP_LIQUIDITY"),
  readLaunch("PERMANENT_LIQUIDITY"),
  readLaunch("LP_FEE"),
  readLaunch("TICK_SPACING"),
  readLaunch("otfIsCurrency0"),
  readLaunch("initialTick"),
  readLaunch("finalTick"),
  readLaunch("initialSqrtPriceX96"),
  readLaunch("finalSqrtPriceX96"),
  readLaunch("initialOtfPriceWethWad"),
  readLaunch("finalOtfPriceWethWad"),
  readLaunch("poolId"),
  readLaunch("bootstrapSqrtPriceBounds"),
  readLaunch("derivedLaunchAmounts"),
]);
const expectedOtfIsCurrency0 = BigInt(otfToken.address) < BigInt(weth);
const expectedInitialTick = expectedOtfIsCurrency0 ? -180_161 : 180_161;
const expectedFinalTick = expectedOtfIsCurrency0 ? -158_188 : 158_188;
const expectedInitialSqrtPriceX96 = expectedOtfIsCurrency0
  ? 9_703_428_570_912_459_262_669_889n
  : 646_895_238_060_830_617_511_325_894_307_352n;
const expectedFinalSqrtPriceX96 = expectedOtfIsCurrency0
  ? 29_110_022_932_210_076_965_716_350n
  : 215_633_692_560_272_871_859_121_182_412_411n;
const requireLaunchValue = (name, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`Launch ${name} mismatch: expected ${expected}, received ${actual}`);
  }
};
requireLaunchValue("MAX_BOOTSTRAP_BUDGET", maxBootstrapBudget, 150_000_000n * 10n ** 18n);
requireLaunchValue("PERMANENT_OTF_CAP", permanentOtfCap, 50_000_000n * 10n ** 18n);
requireLaunchValue("REQUIRED_OTF_BALANCE", requiredLaunchBalance, 200_000_000n * 10n ** 18n);
requireLaunchValue("BOOTSTRAP_LIQUIDITY", bootstrapLiquidity, 27_556_748_080_852_150_400_017n);
requireLaunchValue("PERMANENT_LIQUIDITY", permanentLiquidity, 18_371_007_233_046_122_951_295n);
requireLaunchValue("LP_FEE", poolFee, 0);
requireLaunchValue("TICK_SPACING", tickSpacing, 1);
requireLaunchValue("otfIsCurrency0", otfIsCurrency0, expectedOtfIsCurrency0);
requireLaunchValue("initialTick", initialTick, expectedInitialTick);
requireLaunchValue("finalTick", finalTick, expectedFinalTick);
requireLaunchValue("initialSqrtPriceX96", initialSqrtPriceX96, expectedInitialSqrtPriceX96);
requireLaunchValue("finalSqrtPriceX96", finalSqrtPriceX96, expectedFinalSqrtPriceX96);
requireLaunchValue("initialOtfPriceWethWad", initialOtfPriceWethWad, 15_000_000_000n);
requireLaunchValue("finalOtfPriceWethWad", finalOtfPriceWethWad, 134_997_562_702n);
requireLaunchValue(
  "tick distance",
  initialTick > finalTick ? initialTick - finalTick : finalTick - initialTick,
  21_973,
);

const [derivedBootstrapOtf, derivedBootstrapWeth, derivedPermanentOtf, derivedPermanentWeth] = derivedLaunchAmounts;
const expectedBootstrapOtf = expectedOtfIsCurrency0
  ? 149_997_417_396_300_389_512_897_535n
  : 149_997_417_396_300_389_512_897_549n;
const expectedPermanentOtf = expectedOtfIsCurrency0
  ? 49_999_999_999_999_999_999_997_973n
  : 49_999_999_999_999_999_999_997_974n;
requireLaunchValue("derived bootstrap OTF", derivedBootstrapOtf, expectedBootstrapOtf);
requireLaunchValue("derived bootstrap WETH", derivedBootstrapWeth, 6_749_878_135_132_658_333n);
requireLaunchValue("derived permanent OTF", derivedPermanentOtf, expectedPermanentOtf);
requireLaunchValue("derived permanent WETH", derivedPermanentWeth, 6_749_878_135_132_658_333n);
requireLaunchValue("bootstrap/permanent WETH equality", derivedBootstrapWeth, derivedPermanentWeth);
if (derivedBootstrapOtf > maxBootstrapBudget || derivedPermanentOtf > permanentOtfCap) {
  throw new Error("Derived launch amounts exceed their OTF safety caps");
}
const expectedBootstrapBounds = expectedOtfIsCurrency0
  ? [9_703_508_046_175_219_238_931_631n, expectedFinalSqrtPriceX96]
  : [expectedFinalSqrtPriceX96, 646_889_939_753_375_374_376_401_562_675_059n];
requireLaunchValue("bootstrap lower sqrt boundary", bootstrapSqrtPriceBounds[0], expectedBootstrapBounds[0]);
requireLaunchValue("bootstrap upper sqrt boundary", bootstrapSqrtPriceBounds[1], expectedBootstrapBounds[1]);
const q96 = 1n << 96n;
const actualFinalReferenceFdvWei = otfIsCurrency0
  ? finalSqrtPriceX96 * finalSqrtPriceX96 * 10n ** 27n / (q96 * q96)
  : q96 * q96 * 10n ** 27n / (finalSqrtPriceX96 * finalSqrtPriceX96);
requireLaunchValue("actualFinalReferenceFdvWei", actualFinalReferenceFdvWei, 134_997_562_702_653_186_573n);

const launchRouter = await deploy("OTFLaunchRouter", [launchManager.address]);
const buybackCollector = await deploy("BuybackCollector", [
  launchManager.address,
  uniswapUniversalRouter,
  permit2,
]);
const vaultImplementation = await deploy("ManagedOTFVault");
const factory = await deploy("OTFFactory", [
  vaultImplementation.address,
  buybackCollector.address,
  otfToken.address,
]);
const entryRouter = await deploy("OTFEntryExitRouter", [factory.address, protocolMultisig, weth]);
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
const teamVesting = await deploy("TeamMarketCapVesting", [
  launchManager.address,
  fakeEthUsdOracle.address,
  oracleMaxAge,
  teamBeneficiary,
]);
const merkleRewardsDistributor = await deploy("MerkleRewardsDistributor", [
  otfToken.address,
  protocolMultisig,
]);
const rewardsDeploymentBlock = await publicClient.getBlock({
  blockNumber: merkleRewardsDistributor.blockNumber,
});
merkleRewardsDistributor.blockTimestamp = new Date(
  Number(rewardsDeploymentBlock.timestamp) * 1_000,
).toISOString();

const setupTransactions = {};
setupTransactions.collectorFactory = await transact(
  { ...buybackCollector, name: "BuybackCollector" },
  "configureFactory",
  [factory.address],
);
setupTransactions.factoryRouter = await transact(
  { ...factory, name: "OTFFactory" },
  "configureEntryExitRouter",
  [entryRouter.address],
);
setupTransactions.v3AdapterApproval = await transact(
  { ...entryRouter, name: "OTFEntryExitRouter" },
  "setAdapterApproved",
  [uniswapV3Adapter.address, true],
);
setupTransactions.v4AdapterApproval = await transact(
  { ...entryRouter, name: "OTFEntryExitRouter" },
  "setAdapterApproved",
  [uniswapV4Adapter.address, true],
);

const sampleOtfs = [];
const sampleOtfConfiguration = testnetOtfSeedConfiguration(assetCatalog, protocolMultisig);
for (const configuration of sampleOtfConfiguration) {
  const transaction = await transact(
    { ...factory, name: "OTFFactory" },
    "createVault",
    [configuration],
  );
  const vaultCount = await publicClient.readContract({
    address: factory.address,
    abi: artifact("OTFFactory").abi,
    functionName: "vaultCount",
  });
  if (vaultCount !== BigInt(sampleOtfs.length + 1)) {
    throw new Error(`Unexpected vault count after creating ${configuration.symbol}`);
  }
  const vault = getAddress(await publicClient.readContract({
    address: factory.address,
    abi: artifact("OTFFactory").abi,
    functionName: "vaultAt",
    args: [vaultCount - 1n],
  }));
  sampleOtfs.push({
    address: vault,
    ...configuration,
    transactionHash: transaction.transactionHash,
    blockNumber: transaction.blockNumber,
    gasUsed: transaction.gasUsed,
  });
}
setupTransactions.sampleOtfCreations = sampleOtfs.map((sample) => ({
  address: sample.address,
  transactionHash: sample.transactionHash,
  blockNumber: sample.blockNumber,
  gasUsed: sample.gasUsed,
}));

const transfer = async (to, amount) => transact(
  { ...otfToken, name: "OTFToken" },
  "transfer",
  [to, amount],
);
setupTransactions.teamAllocation = await transfer(teamVesting.address, 100_000_000n * 10n ** 18n);
setupTransactions.launchApproval = await transact(
  { ...otfToken, name: "OTFToken" },
  "approve",
  [launchManager.address, requiredLaunchBalance],
);
setupTransactions.rewardsAllocation = await transfer(
  merkleRewardsDistributor.address,
  700_000_000n * 10n ** 18n,
);
setupTransactions.launchInitialization = await transact(
  { ...launchManager, name: "OTFLaunchManager" },
  "initializeLaunch",
);

const [actualBootstrapOtf, initializedPoolState, bootstrapPositionLiquidity] = await Promise.all([
  readLaunch("bootstrapOtfDeposited"),
  publicClient.readContract({
    address: uniswapV4StateView,
    abi: [{
      type: "function",
      name: "getSlot0",
      stateMutability: "view",
      inputs: [{ name: "poolId", type: "bytes32" }],
      outputs: [
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "protocolFee", type: "uint24" },
        { name: "lpFee", type: "uint24" },
      ],
    }],
    functionName: "getSlot0",
    args: [poolId],
  }),
  readLaunch("bootstrapLiquidity"),
]);
requireLaunchValue("actual bootstrap OTF debit", actualBootstrapOtf, expectedBootstrapOtf);
requireLaunchValue("initialized pool sqrt price", initializedPoolState[0], expectedInitialSqrtPriceX96);
requireLaunchValue("initialized pool tick", initializedPoolState[1], expectedOtfIsCurrency0 ? -180_162 : 180_161);
requireLaunchValue("initialized bootstrap liquidity", bootstrapPositionLiquidity, bootstrapLiquidity);

const tokenBalance = (holder) => publicClient.readContract({
  address: otfToken.address,
  abi: artifact("OTFToken").abi,
  functionName: "balanceOf",
  args: [holder],
});
const [
  deployerOtfBalance,
  teamOtfBalance,
  launchReserveBalance,
  rewardsOtfBalance,
  totalSupply,
  deployedTeamBeneficiary,
  pendingTeamBeneficiary,
  launchOtfAllowance,
  launchWethAllowance,
  launchOtfPermit2Allowance,
  launchWethPermit2Allowance,
] = await Promise.all([
    tokenBalance(account.address),
    tokenBalance(teamVesting.address),
    tokenBalance(launchManager.address),
    tokenBalance(merkleRewardsDistributor.address),
    publicClient.readContract({
      address: otfToken.address,
      abi: artifact("OTFToken").abi,
      functionName: "totalSupply",
    }),
    publicClient.readContract({
      address: teamVesting.address,
      abi: artifact("TeamMarketCapVesting").abi,
      functionName: "beneficiary",
    }),
    publicClient.readContract({
      address: teamVesting.address,
      abi: artifact("TeamMarketCapVesting").abi,
      functionName: "pendingBeneficiary",
    }),
    publicClient.readContract({ address: otfToken.address, abi: artifact("OTFToken").abi, functionName: "allowance", args: [launchManager.address, permit2] }),
    publicClient.readContract({ address: weth, abi: artifact("OTFToken").abi, functionName: "allowance", args: [launchManager.address, permit2] }),
    publicClient.readContract({
      address: permit2,
      abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }],
      functionName: "allowance",
      args: [launchManager.address, otfToken.address, uniswapV4PositionManager],
    }),
    publicClient.readContract({
      address: permit2,
      abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }],
      functionName: "allowance",
      args: [launchManager.address, weth, uniswapV4PositionManager],
    }),
  ]);
if (deployerOtfBalance !== 0n) throw new Error("Unrestricted deployer retained OTF");
if (teamOtfBalance !== 100_000_000n * 10n ** 18n) throw new Error("Team allocation mismatch");
if (launchReserveBalance !== requiredLaunchBalance - actualBootstrapOtf) throw new Error("Launch reserve does not reconcile to the actual bootstrap debit");
if (rewardsOtfBalance !== 700_000_000n * 10n ** 18n) throw new Error("Rewards allocation mismatch");
if (totalSupply !== 1_000_000_000n * 10n ** 18n) throw new Error("Original OTF issuance mismatch");
if (deployedTeamBeneficiary !== teamBeneficiary) throw new Error("Initial team beneficiary mismatch");
if (pendingTeamBeneficiary !== "0x0000000000000000000000000000000000000000") {
  throw new Error("Unexpected pending team beneficiary");
}
if (launchOtfAllowance !== 0n || launchWethAllowance !== 0n) throw new Error("Launch manager retained an ERC20 allowance");
if (launchOtfPermit2Allowance[0] !== 0n || launchWethPermit2Allowance[0] !== 0n) throw new Error("Launch manager retained a Permit2 allowance");

await Promise.all([
  verifyAddressBinding("New adapter entry router", uniswapV3Adapter.address, "entryExitRouter", entryRouter.address),
  verifyAddressBinding("New adapter factory", uniswapV3Adapter.address, "uniswapV3Factory", uniswapV3Factory),
  verifyAddressBinding("New adapter SwapRouter02", uniswapV3Adapter.address, "uniswapV3Router", uniswapV3SwapRouter02),
  verifyAddressBinding("New router WETH", entryRouter.address, "weth", weth),
  verifyAddressBinding("New router factory", entryRouter.address, "factory", factory.address),
  verifyAddressBinding("New collector factory", buybackCollector.address, "factory", factory.address),
]);
for (const adapter of [uniswapV3Adapter.address, uniswapV4Adapter.address]) {
  if (!await publicClient.readContract({ address: entryRouter.address, abi: artifact("OTFEntryExitRouter").abi, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("Replacement adapter is not approved");
}

const previousRouter = previous.contracts?.entryRouter?.address;
const previousAdapters = [
  previous.contracts?.uniswapV3Adapter?.address,
  previous.contracts?.uniswapV4Adapter?.address,
].filter(Boolean);
if (previousRouter && previousAdapters.length > 0) {
  setupTransactions.revokePreviousAdapters = [];
  for (const previousAdapter of previousAdapters) {
    const revocation = await transact(
      { name: "OTFEntryExitRouter", address: previousRouter }, "setAdapterApproved", [previousAdapter, false],
    );
    const approved = await publicClient.readContract({ address: previousRouter, abi: artifact("OTFEntryExitRouter").abi,
      functionName: "isAdapterApproved", args: [previousAdapter] });
    if (approved) throw new Error("Previous adapter was not revoked");
    setupTransactions.revokePreviousAdapters.push({ adapter: previousAdapter, ...revocation });
  }
}
const deployment = {
  network: "robinhood-testnet",
  chainId,
  rpcUrl,
  status: "deployed",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  trustedRoles: { protocolMultisig, teamBeneficiary },
  contracts: {
    otfToken,
    launchManager,
    launchRouter,
    teamVesting,
    buybackCollector,
    merkleRewardsDistributor,
    fakeEthUsdOracle,
    vaultImplementation,
    factory,
    entryRouter,
    uniswapV3Adapter,
    uniswapV4Adapter,
  },
  deploymentTools: { launchManagerDeployer },
  externalContracts: {
    ...external,
    uniswapV3Factory,
    uniswapV3SwapRouter02,
    uniswapV4PoolManager,
    uniswapV4StateView,
    uniswapV4PositionManager,
    uniswapV4Quoter,
    uniswapUniversalRouter,
    permit2,
    weth,
  },
  expectedCodehashes: { ...pinnedCodehashes, ...expectedCodehashes },
  launch: {
    poolFee,
    tickSpacing,
    maxBootstrapBudgetOtf: maxBootstrapBudget,
    permanentOtfCap,
    requiredLaunchBalanceOtf: requiredLaunchBalance,
    bootstrapLiquidity,
    permanentLiquidity,
    derivedBootstrapOtf,
    derivedBootstrapWethPrincipalWei: derivedBootstrapWeth,
    derivedPermanentOtf,
    derivedPermanentWeth: derivedPermanentWeth,
    exactInitializationReferenceFdvWei: 15n * 10n ** 18n,
    nominalTargetReferenceFdvWei: 135n * 10n ** 18n,
    actualFinalReferenceFdvWei,
    initialOtfPriceWethWad,
    finalOtfPriceWethWad,
    otfIsCurrency0,
    initialTick,
    finalTick,
    initialSqrtPriceX96,
    finalSqrtPriceX96,
    bootstrapSqrtPriceLowerX96: bootstrapSqrtPriceBounds[0],
    bootstrapSqrtPriceUpperX96: bootstrapSqrtPriceBounds[1],
  },
  allocations: {
    teamVestingOtf: "100000000000000000000000000",
    launchSystemOtf: "200000000000000000000000000",
    merkleRewardsOtf: "700000000000000000000000000",
    unrestrictedDeployerOtf: "0",
  },
  routing: {
    status: "ready",
    integration: "approved-trade-adapters",
    approvedAdapters: [uniswapV3Adapter.address, uniswapV4Adapter.address],
    uniswapV3Adapter: uniswapV3Adapter.address,
    uniswapV4Adapter: uniswapV4Adapter.address,
    launchRouter: launchRouter.address,
    nativeEntryExitEnabled: true,
    v4RouteData: "abi.encode((address,uint24,int24,address,bytes)[])",
    maxV4HopsPerLeg: 3,
    maxLegs: 40,
  },
  sampleOtfs,
  setupTransactions,
  ...appOwnedIntegrations,
  note: "Protocol contracts are deployed.",
  ...(simulation ? { simulation: true, transactions, totalGas } : {}),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${json(deployment)}\n`);
if (!simulation) {
  const verifiedPath = join(root, "app/src/config/verified_assets.json");
  const verified = JSON.parse(readFileSync(verifiedPath, "utf8")).filter((asset) =>
    !(asset.chainId === chainId && asset.tokenAddress.toLowerCase() === previous.contracts.otfToken.address.toLowerCase()));
  verified.unshift({ chainId, tokenAddress: otfToken.address, approvedPricingConfigs: [{ source: "otf-launch-manager", feedAddress: launchManager.address, maxStaleness: 90000 }] });
  writeFileSync(verifiedPath, `${json(verified)}\n`);
  for (const pool of assetCatalog.pools) pool.status = "seeded";
  writeFileSync(join(root, "app/src/config/robinhood-testnet-assets.json"), `${json(assetCatalog)}\n`);
}
console.log(`Deployment ${simulation ? "simulation" : "configuration"} written to ${outputPath}; gas ${totalGas}`);
