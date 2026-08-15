import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const viem = await import(pathToFileURL(appRequire.resolve("viem")).href);
const accounts = await import(pathToFileURL(appRequire.resolve("viem/accounts")).href);
const {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  nonceManager,
} = viem;
const { privateKeyToAccount } = accounts;

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

async function requireCode(label, address) {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`${label} has no bytecode at ${address}.`);
}

async function writeContract(address, abi, functionName, args) {
  const hash = await wallet.writeContract({ address, abi, functionName, args, chain, account });
  console.log(`${functionName} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

const configuredPath = requiredEnv("PROTOCOL_DEPLOYMENT_PATH");
const deploymentPath = isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
if (!existsSync(deploymentPath)) throw new Error(`Deployment file does not exist: ${deploymentPath}`);
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
const rpcUrl = env("RPC_URL", deployment.rpcUrl);
if (!rpcUrl) throw new Error("RPC_URL or deployment.rpcUrl is required.");
const chainId = Number(deployment.chainId);
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error(`Invalid deployment chain ID: ${deployment.chainId}`);
}

const contracts = deployment.contracts ?? {};
const externalContracts = deployment.externalContracts ?? {};
const priorVenue = deployment.zeroXVenue ?? {};
const factory = parseAddress("contracts.factory.address", contracts.factory?.address);
const entryRouter = parseAddress("contracts.entryRouter.address", contracts.entryRouter?.address);
const rebalanceExecutor = parseAddress(
  "contracts.rebalanceExecutor.address",
  contracts.rebalanceExecutor?.address,
);
const settlementToken = parseAddress(
  "settlement token",
  env("ZEROX_SETTLEMENT_TOKEN", priorVenue.settlementToken ?? externalContracts.usdg),
);
const swapTarget = parseAddress(
  "0x swap target",
  env("ZEROX_SWAP_TARGET", priorVenue.swapTarget),
);
const allowanceTarget = parseAddress(
  "0x allowance target",
  env("ZEROX_ALLOWANCE_TARGET", priorVenue.allowanceTarget),
);

const account = privateKeyToAccount(privateKey, { nonceManager });
const chain = {
  id: chainId,
  name: deployment.network ?? `Chain ${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId) {
  throw new Error(`RPC returned chain ID ${actualChainId}, expected ${chainId}.`);
}

await Promise.all([
  requireCode("Factory", factory),
  requireCode("Entry router", entryRouter),
  requireCode("Rebalance executor", rebalanceExecutor),
  requireCode("Settlement token", settlementToken),
  requireCode("Configured 0x swap target", swapTarget),
  requireCode("Configured 0x allowance target", allowanceTarget),
]);

const adapterArtifact = artifact("ZeroXSwapAdapter.sol", "ZeroXSwapAdapter");
const factoryArtifact = artifact("OTFFactory.sol", "OTFFactory");
const entryRouterArtifact = artifact("OTFEntryRouter.sol", "OTFEntryRouter");
const forceRedeploy = env("FORCE_ZEROX_ADAPTER_REDEPLOY", "false").toLowerCase() === "true";
let adapterAddress;
let deploymentEvidence;
const configuredAdapter = contracts.zeroXSwapAdapter?.address;

if (configuredAdapter && !forceRedeploy) {
  adapterAddress = parseAddress("contracts.zeroXSwapAdapter.address", configuredAdapter);
  await requireCode("Configured ZeroXSwapAdapter", adapterAddress);
  const [owner, configuredSwapTarget, configuredAllowanceTarget, configuredSettlementToken] =
    await Promise.all([
      publicClient.readContract({ address: adapterAddress, abi: adapterArtifact.abi, functionName: "owner" }),
      publicClient.readContract({ address: adapterAddress, abi: adapterArtifact.abi, functionName: "swapTarget" }),
      publicClient.readContract({ address: adapterAddress, abi: adapterArtifact.abi, functionName: "allowanceTarget" }),
      publicClient.readContract({ address: adapterAddress, abi: adapterArtifact.abi, functionName: "settlementToken" }),
    ]);
  if (!isAddressEqual(owner, account.address)) {
    throw new Error(`Signer ${account.address} does not own configured adapter ${adapterAddress}.`);
  }
  if (
    !isAddressEqual(configuredSwapTarget, swapTarget)
    || !isAddressEqual(configuredAllowanceTarget, allowanceTarget)
    || !isAddressEqual(configuredSettlementToken, settlementToken)
  ) {
    throw new Error("Configured ZeroXSwapAdapter dependencies do not match the requested targets.");
  }
  deploymentEvidence = { ...contracts.zeroXSwapAdapter, alreadyConfigured: true };
} else {
  const bytecode = adapterArtifact.bytecode.object.startsWith("0x")
    ? adapterArtifact.bytecode.object
    : `0x${adapterArtifact.bytecode.object}`;
  const hash = await wallet.deployContract({
    abi: adapterArtifact.abi,
    bytecode,
    args: [account.address, swapTarget, allowanceTarget, settlementToken],
    chain,
    account,
  });
  console.log(`ZeroXSwapAdapter tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`ZeroXSwapAdapter deployment reverted: ${hash}`);
  }
  adapterAddress = getAddress(receipt.contractAddress);
  deploymentEvidence = {
    address: adapterAddress,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

const ownerAbi = [{
  type: "function",
  name: "owner",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}];
const [factoryOwner, entryRouterOwner] = await Promise.all([
  publicClient.readContract({ address: factory, abi: ownerAbi, functionName: "owner" }),
  publicClient.readContract({ address: entryRouter, abi: ownerAbi, functionName: "owner" }),
]);
if (!isAddressEqual(factoryOwner, account.address) || !isAddressEqual(entryRouterOwner, account.address)) {
  throw new Error("Signer must own both the factory and entry router to configure the adapter.");
}

const setup = {};
const tradeApproved = await publicClient.readContract({
  address: factory,
  abi: factoryArtifact.abi,
  functionName: "isTradeAdapterApproved",
  args: [adapterAddress],
});
setup.factoryApproval = tradeApproved
  ? { alreadyConfigured: true }
  : await writeContract(
    factory,
    factoryArtifact.abi,
    "setTradeAdapterApproved",
    [adapterAddress, true],
  );

const entryApproved = await publicClient.readContract({
  address: entryRouter,
  abi: entryRouterArtifact.abi,
  functionName: "isEntryAdapterApproved",
  args: [adapterAddress],
});
setup.entryRouterApproval = entryApproved
  ? { alreadyConfigured: true }
  : await writeContract(
    entryRouter,
    entryRouterArtifact.abi,
    "setEntryAdapterApproved",
    [adapterAddress, true],
  );

for (const [label, caller] of [["rebalanceExecutor", rebalanceExecutor], ["entryRouter", entryRouter]]) {
  const approved = await publicClient.readContract({
    address: adapterAddress,
    abi: adapterArtifact.abi,
    functionName: "isCallerApproved",
    args: [caller],
  });
  setup[`${label}CallerApproval`] = approved
    ? { alreadyConfigured: true }
    : await writeContract(
      adapterAddress,
      adapterArtifact.abi,
      "setCallerApproved",
      [caller, true],
    );
}

deployment.contracts ??= {};
deployment.contracts.zeroXSwapAdapter = deploymentEvidence;
deployment.zeroXVenue = {
  apiVersion: "v2",
  approvalFlow: "allowance-holder",
  settlementToken,
  swapTarget,
  allowanceTarget,
  configuredAt: new Date().toISOString(),
};
deployment.setupTransactions ??= {};
deployment.setupTransactions.zeroXAdapter = setup;
writeFileSync(deploymentPath, `${serialize(deployment)}\n`);
console.log(`0x adapter configuration written to ${deploymentPath}`);
