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
const weth = address("WETH", env("WETH"));
const oracleMaxAge = positiveInteger("ORACLE_MAX_AGE_SECONDS", env("ORACLE_MAX_AGE_SECONDS"));
const account = privateKeyToAccount(privateKey, { nonceManager });
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim()
  || previous.rpcUrl
  || "https://rpc.testnet.chain.robinhood.com";
const chainId = 46630;
const external = previous.externalContracts ?? {};
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
const uniswapUniversalRouter = address(
  "externalContracts.uniswapUniversalRouter",
  external.uniswapUniversalRouter,
);
const permit2 = address("externalContracts.permit2", external.permit2);
const uniswapV4PositionManager = address(
  "UNISWAP_V4_POSITION_MANAGER",
  env("UNISWAP_V4_POSITION_MANAGER"),
);
const pinnedCodehashes = previous.expectedCodehashes ?? {};

const expectedCodehashes = {
  uniswapV4PoolManager: pinnedCodehash(pinnedCodehashes, "uniswapV4PoolManager", "UNISWAP_V4_POOL_MANAGER_CODEHASH"),
  uniswapV4StateView: pinnedCodehash(pinnedCodehashes, "uniswapV4StateView", "UNISWAP_V4_STATE_VIEW_CODEHASH"),
  uniswapV4PositionManager: bytes32("UNISWAP_V4_POSITION_MANAGER_CODEHASH", env("UNISWAP_V4_POSITION_MANAGER_CODEHASH")),
  uniswapUniversalRouter: pinnedCodehash(pinnedCodehashes, "uniswapUniversalRouter", "UNISWAP_UNIVERSAL_ROUTER_CODEHASH"),
  permit2: pinnedCodehash(pinnedCodehashes, "permit2", "PERMIT2_CODEHASH"),
};

const chain = {
  id: chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
if (await publicClient.getChainId() !== chainId) {
  throw new Error("RPC chain ID does not match Robinhood Testnet");
}

async function verifyCodehash(name, contractAddress, expected) {
  const code = await publicClient.getCode({ address: contractAddress });
  if (!code || code === "0x") throw new Error(`${name} has no code`);
  const actual = keccak256(code).toLowerCase();
  if (actual !== expected) {
    throw new Error(`${name} codehash mismatch: expected ${expected}, received ${actual}`);
  }
}

await verifyCodehash("Uniswap V4 PoolManager", uniswapV4PoolManager, expectedCodehashes.uniswapV4PoolManager);
await verifyCodehash("Uniswap V4 StateView", uniswapV4StateView, expectedCodehashes.uniswapV4StateView);
await verifyCodehash("Uniswap V4 PositionManager", uniswapV4PositionManager, expectedCodehashes.uniswapV4PositionManager);
await verifyCodehash("Uniswap Universal Router", uniswapUniversalRouter, expectedCodehashes.uniswapUniversalRouter);
await verifyCodehash("Permit2", permit2, expectedCodehashes.permit2);

async function deploy(name, args = []) {
  const compiled = artifact(name);
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: bytecode(name), args, chain, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${name} deployment reverted`);
  }
  return {
    address: getAddress(receipt.contractAddress),
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

async function transact(contract, functionName, args = []) {
  const hash = await wallet.writeContract({
    address: contract.address,
    abi: artifact(contract.name).abi,
    functionName,
    args,
    chain,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${contract.name}.${functionName} reverted`);
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
const requiredLaunchHookFlags = 0x2040n;
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
  throw new Error("Could not mine beforeInitialize + afterSwap hook address with mask 0x2040");
}
if ((BigInt(launchAddress) & allHookFlags) !== requiredLaunchHookFlags) {
  throw new Error("Mined launch-manager hook address does not have the exact 0x2040 mask");
}
const launchDeploymentTx = await transact(
  { ...launchManagerDeployer, name: "OTFLaunchManagerDeployer" },
  "deploy",
  [launchSalt, ...launchConstructorArgs],
);
const launchManager = { address: launchAddress, ...launchDeploymentTx, salt: launchSalt };

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
setupTransactions.collectorRouter = await transact(
  { ...buybackCollector, name: "BuybackCollector" },
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

const transfer = async (to, amount) => transact(
  { ...otfToken, name: "OTFToken" },
  "transfer",
  [to, amount],
);
setupTransactions.teamAllocation = await transfer(teamVesting.address, 100_000_000n * 10n ** 18n);
setupTransactions.launchAllocation = await transfer(launchManager.address, 200_000_000n * 10n ** 18n);
setupTransactions.rewardsAllocation = await transfer(
  merkleRewardsDistributor.address,
  700_000_000n * 10n ** 18n,
);
setupTransactions.launchInitialization = await transact(
  { ...launchManager, name: "OTFLaunchManager" },
  "initializeLaunch",
);

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
  ]);
if (deployerOtfBalance !== 0n) throw new Error("Unrestricted deployer retained OTF");
if (teamOtfBalance !== 100_000_000n * 10n ** 18n) throw new Error("Team allocation mismatch");
const permanentLaunchReserve = 50_000_000n * 10n ** 18n;
const maximumBootstrapDust = 1_000n * 10n ** 18n;
if (
  launchReserveBalance < permanentLaunchReserve
  || launchReserveBalance > permanentLaunchReserve + maximumBootstrapDust
) throw new Error("Launch reserve or bootstrap dust mismatch");
if (rewardsOtfBalance !== 700_000_000n * 10n ** 18n) throw new Error("Rewards allocation mismatch");
if (totalSupply !== 1_000_000_000n * 10n ** 18n) throw new Error("Original OTF issuance mismatch");
if (deployedTeamBeneficiary !== teamBeneficiary) throw new Error("Initial team beneficiary mismatch");
if (pendingTeamBeneficiary !== "0x0000000000000000000000000000000000000000") {
  throw new Error("Unexpected pending team beneficiary");
}

const deployment = {
  architecture: "otf-fee-settlement-v3",
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
  externalContracts: {
    uniswapV3Factory,
    uniswapV3SwapRouter02,
    uniswapV4PoolManager,
    uniswapV4StateView,
    uniswapV4PositionManager,
    uniswapUniversalRouter,
    permit2,
    weth,
  },
  expectedCodehashes,
  launch: {
    poolFee: 0,
    tickSpacing: 1,
    bootstrapOtf: "150000000000000000000000000",
    permanentLiquidityReserveOtf: "50000000000000000000000000",
  },
  allocations: {
    teamVestingOtf: "100000000000000000000000000",
    launchSystemOtf: "200000000000000000000000000",
    merkleRewardsOtf: "700000000000000000000000000",
    unrestrictedDeployerOtf: "0",
  },
  routing: {
    integration: "approved-trade-adapters",
    approvedAdapters: [uniswapV3Adapter.address, uniswapV4Adapter.address],
    uniswapV3Adapter: uniswapV3Adapter.address,
    uniswapV4Adapter: uniswapV4Adapter.address,
    nativeEntryExitEnabled: true,
    v4RouteData: "abi.encode((address,uint24,int24,address,bytes)[])",
    maxV4HopsPerLeg: 3,
    maxLegs: 40,
  },
  setupTransactions,
  ...appOwnedIntegrations,
  note: "Breaking fee-settlement v3 deployment; earlier protocol contracts are unsupported.",
};
mkdirSync(dirname(deploymentPath), { recursive: true });
writeFileSync(deploymentPath, `${json(deployment)}\n`);
console.log(`Deployment configuration written to ${deploymentPath}`);
