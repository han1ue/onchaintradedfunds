import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.deploy.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    const raw = match[2];
    const quoted = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"'))
      || (raw.startsWith("'") && raw.endsWith("'")));
    process.env[match[1]] = quoted ? raw.slice(1, -1) : raw;
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
  maxUint256,
  nonceManager,
  zeroAddress,
} = viem;
const { privateKeyToAccount } = accounts;

const deployment = JSON.parse(readFileSync(
  join(root, "app", "src", "config", "robinhood-testnet.json"),
  "utf8",
));
const external = deployment.externalContracts ?? {};
const rpcUrl = process.env.RH_TESTNET_RPC_URL?.trim() || deployment.rpcUrl;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() || process.env.PRIVATE_KEY?.trim();
if (!privateKey) throw new Error("Missing DEPLOYER_PRIVATE_KEY or PRIVATE_KEY.");

const chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const account = privateKeyToAccount(privateKey, { nonceManager });
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const weth = getAddress(external.weth);
const usdg = getAddress(external.usdg);
const factory = getAddress(external.uniswapV3Factory);
const positionManager = getAddress(external.uniswapV3PositionManager);
const fee = 100;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];
const wethAbi = [
  ...erc20Abi,
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
];
const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
  { type: "function", name: "feeAmountTickSpacing", stateMutability: "view", inputs: [{ type: "uint24" }], outputs: [{ type: "int24" }] },
];
const positionManagerAbi = [
  {
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
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{
      type: "tuple",
      name: "params",
      components: [
        { type: "address", name: "token0" },
        { type: "address", name: "token1" },
        { type: "uint24", name: "fee" },
        { type: "int24", name: "tickLower" },
        { type: "int24", name: "tickUpper" },
        { type: "uint256", name: "amount0Desired" },
        { type: "uint256", name: "amount1Desired" },
        { type: "uint256", name: "amount0Min" },
        { type: "uint256", name: "amount1Min" },
        { type: "address", name: "recipient" },
        { type: "uint256", name: "deadline" },
      ],
    }],
    outputs: [
      { type: "uint256", name: "tokenId" },
      { type: "uint128", name: "liquidity" },
      { type: "uint256", name: "amount0" },
      { type: "uint256", name: "amount1" },
    ],
  },
];
const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
];

function integerSqrt(value) {
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

async function confirmedWrite({ address, abi, functionName, args = [], value }) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
    ...(value ? { value } : {}),
  });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  console.log(`${functionName}: ${hash}`);
  return receipt;
}

const nativeBalance = await publicClient.getBalance({ address: account.address });
console.log(`Bootstrap account: ${account.address} (${formatEther(nativeBalance)} ETH)`);
const tickSpacing = Number(await publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "feeAmountTickSpacing",
  args: [fee],
}));
if (tickSpacing <= 0) throw new Error(`Synthra does not support fee tier ${fee}.`);

const token0 = BigInt(weth) < BigInt(usdg) ? weth : usdg;
const token1 = isAddressEqual(token0, weth) ? usdg : weth;
let pool = await publicClient.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "getPool",
  args: [weth, usdg, fee],
});
if (isAddressEqual(pool, zeroAddress)) {
  // Seed at 1 WETH = 1,625 USDG. This is execution liquidity, not an oracle.
  const q192 = 1n << 192n;
  const wethIsToken0 = isAddressEqual(token0, weth);
  const ratioNumerator = wethIsToken0 ? 1_625n * 10n ** 6n : 10n ** 18n;
  const ratioDenominator = wethIsToken0 ? 10n ** 18n : 1_625n * 10n ** 6n;
  const sqrtPriceX96 = integerSqrt(ratioNumerator * q192 / ratioDenominator);
  await confirmedWrite({
    address: positionManager,
    abi: positionManagerAbi,
    functionName: "createAndInitializePoolIfNecessary",
    args: [token0, token1, fee, sqrtPriceX96],
  });
  pool = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [weth, usdg, fee],
  });
}
pool = getAddress(pool);

let liquidity = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" });
if (liquidity === 0n) {
  const wethDesired = 5n * 10n ** 15n;
  const usdgDesired = 8_125_000n;
  let wethBalance = await publicClient.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (wethBalance < wethDesired) {
    const wrapAmount = wethDesired - wethBalance;
    await confirmedWrite({ address: weth, abi: wethAbi, functionName: "deposit", value: wrapAmount });
    wethBalance += wrapAmount;
  }
  const usdgBalance = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (wethBalance < wethDesired || usdgBalance < usdgDesired) {
    throw new Error("Insufficient WETH or USDG to seed execution liquidity.");
  }
  for (const token of [weth, usdg]) {
    const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, positionManager] });
    if (allowance === 0n) {
      await confirmedWrite({ address: token, abi: erc20Abi, functionName: "approve", args: [positionManager, maxUint256] });
    }
  }
  const amount0Desired = isAddressEqual(token0, weth) ? wethDesired : usdgDesired;
  const amount1Desired = isAddressEqual(token1, usdg) ? usdgDesired : wethDesired;
  const block = await publicClient.getBlock();
  const tickLower = Math.ceil(-887272 / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(887272 / tickSpacing) * tickSpacing;
  await confirmedWrite({
    address: positionManager,
    abi: positionManagerAbi,
    functionName: "mint",
    args: [{
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0n,
      amount1Min: 0n,
      recipient: account.address,
      deadline: block.timestamp + 1_200n,
    }],
  });
  liquidity = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" });
}
if (liquidity === 0n) throw new Error("Execution pool has no active liquidity.");
const [resolvedToken0, resolvedToken1, resolvedFee] = await Promise.all([
  publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
  publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
  publicClient.readContract({ address: pool, abi: poolAbi, functionName: "fee" }),
]);
if (!isAddressEqual(resolvedToken0, token0) || !isAddressEqual(resolvedToken1, token1) || resolvedFee !== fee) {
  throw new Error("Execution pool failed canonical pair verification.");
}
console.log(JSON.stringify({ pool, tokenA: weth, tokenB: usdg, fee, liquidity: liquidity.toString() }, null, 2));
