import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, concatHex,
  numberToHex, zeroAddress, getAddress, parseEventLogs } = require("viem");
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const config = read("app/src/config/robinhood-testnet.json");
const pin = read("scripts/fixtures/robinhood-testnet-routing.json");
const plan = read("scripts/fixtures/robinhood-testnet-v3.json");
const mode = process.env.LIQUIDITY_MODE || "simulate";
const receiptPath = mode === "broadcast" ? "deployments/robinhood-testnet-v3-liquidity.json" : "test-results/v3-auth/liquidity-simulate.json";
const rpcUrl = process.env.TESTNET_RPC_URL || config.rpcUrl;
const chain = { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const client = createPublicClient({ chain, transport: http(rpcUrl) });
await verifyTestnetRoutingRuntime(client, config, pin);
let account = getAddress(config.deployer);
let budget;
if (mode === "simulate") {
  if (!["127.0.0.1", "localhost"].includes(new URL(rpcUrl).hostname)
    || !(await client.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) throw new Error("Simulation requires a local Anvil fork of chain 46630");
  await client.request({ method: "anvil_impersonateAccount", params: [account] });
} else if (mode === "broadcast") {
  if (existsSync(resolve(root, receiptPath))) throw new Error("A live seed receipt already exists; reconcile it before authorizing another funding run");
  if (!process.env.LIQUIDITY_BUDGET_FILE) throw new Error("An explicitly authorized liquidity budget file is required");
  budget = read(process.env.LIQUIDITY_BUDGET_FILE);
  if (budget.chainId !== 46630 || budget.authorized !== true || budget.recipient?.toLowerCase() !== account.toLowerCase()) throw new Error("Liquidity budget chain, authorization, or recipient mismatch");
  for (const market of plan.markets) {
    const cap = budget.markets?.find((item) => item.id === market.id);
    if (!cap || BigInt(cap.assetRaw) < BigInt(market.proposedAssetRaw) || BigInt(cap.quoteRaw) < BigInt(market.proposedQuoteRaw)) throw new Error(`Missing authorized budget for ${market.id}`);
  }
  const requiredWrap = BigInt(plan.markets.find((market) => market.asset === "WETH").proposedAssetRaw);
  if (BigInt(budget.maxNativeWrapWei || "0") < requiredWrap) throw new Error("Native wrapping budget is missing");
  const env = Object.fromEntries(readFileSync(resolve(root, ".env.deploy.local"), "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
  account = require("viem/accounts").privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
  if (account.address.toLowerCase() !== config.deployer.toLowerCase()) throw new Error("Liquidity signer differs from the configured recipient");
} else throw new Error("LIQUIDITY_MODE must be simulate or broadcast");
const recipient = typeof account === "string" ? account : account.address;
const wallet = createWalletClient({ chain, account, transport: http(rpcUrl) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function deposit() payable"]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)", "function feeAmountTickSpacing(uint24) view returns (int24)"]);
const poolAbi = parseAbi(["function factory() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)", "function liquidity() view returns (uint128)", "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"]);
const npm = plan.dependencies.uniswapV3PositionManager.address;
const factory = plan.dependencies.uniswapV3Factory.address;
const quoter = plan.dependencies.uniswapV3QuoterV2.address;
const router = plan.dependencies.uniswapV3SwapRouter02.address;
const npmAbi = read("node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json").abi;
const quoterAbi = read("node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi;
const routerAbi = read("node_modules/@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json").abi;
const transactions = [];
let gasSpend = 0n;
const results = [];
const allowances = new Map();
const save = () => writeFileSync(resolve(root, receiptPath), JSON.stringify({
  chainId: 46630, mode, recipient, transactions, pools: results,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
async function send(address, abi, functionName, args = [], value = 0n) {
  const { request, result } = await client.simulateContract({ address, abi, functionName, args, value, account });
  const estimated = await client.estimateContractGas({ address, abi, functionName, args, value, account });
  const gasPrice = mode === "simulate" ? BigInt(plan.gasPriceWei) : await client.getGasPrice();
  const gas = estimated * 125n / 100n + 50_000n;
  if (budget && (gasPrice > BigInt(budget.maxGasPriceWei) || gasSpend + gas * gasPrice > BigInt(budget.maxSeedGasSpendWei))) throw new Error("Seed transaction exceeds the authorized gas budget");
  const hash = await wallet.writeContract({ ...request, gas, gasPrice });
  const receipt = await client.waitForTransactionReceipt({ hash });
  gasSpend += receipt.gasUsed * receipt.effectiveGasPrice;
  transactions.push({ to: address, functionName, data: encodeFunctionData({ abi, functionName, args }), value, transactionHash: hash,
    blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, status: receipt.status });
  save();
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return { result, receipt };
}
async function approve(token, spender, amount) {
  const key = `${token}:${spender}`;
  const prior = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [recipient, spender] });
  if (prior !== 0n) await send(token, erc20, "approve", [spender, 0n]);
  if (amount !== 0n) { allowances.set(key, [token, spender]); await send(token, erc20, "approve", [spender, amount]); }
}
const totalQuote = plan.markets.reduce((total, market) => total + BigInt(market.proposedQuoteRaw), 0n);
const quote = plan.markets[0].quoteAddress;
if (await client.readContract({ address: quote, abi: erc20, functionName: "balanceOf", args: [recipient] }) < totalQuote) throw new Error("Insufficient USDG for the entire proposal");
let wrap = 0n;
for (const market of plan.markets) {
  const balance = await client.readContract({ address: market.assetAddress, abi: erc20, functionName: "balanceOf", args: [recipient] });
  const need = BigInt(market.proposedAssetRaw);
  if (market.asset === "WETH") wrap = need > balance ? need - balance : 0n;
  else if (balance < need) throw new Error(`Insufficient ${market.asset} for the proposal`);
}
if (await client.getBalance({ address: recipient }) < wrap + 10n ** 16n) throw new Error("Insufficient native balance for wrapping and the gas reserve");
try {
  if (wrap > 0n) await send(plan.protocolWeth, erc20, "deposit", [], wrap);
  for (const market of plan.markets) {
    if (await client.readContract({ address: factory, abi: factoryAbi, functionName: "feeAmountTickSpacing", args: [market.fee] }) !== market.tickSpacing) throw new Error("Tick spacing changed");
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [market.token0, market.token1, market.fee] });
    if (pool !== zeroAddress && pool.toLowerCase() !== market.address.toLowerCase()) throw new Error("Pool differs from its authenticated CREATE2 address");
    await send(npm, npmAbi, "createAndInitializePoolIfNecessary", [market.token0, market.token1, market.fee, BigInt(market.sqrtPriceX96)]);
    const sqrt = (await client.readContract({ address: market.address, abi: poolAbi, functionName: "slot0" }))[0];
    const planned = BigInt(market.sqrtPriceX96);
    if (sqrt * 1000n < planned * 995n || sqrt * 1000n > planned * 1005n) throw new Error(`${market.id} price has moved more than 1% from the proposal`);
    const assetIs0 = market.token0.toLowerCase() === market.assetAddress.toLowerCase();
    const amount0Desired = BigInt(assetIs0 ? market.proposedAssetRaw : market.proposedQuoteRaw);
    const amount1Desired = BigInt(assetIs0 ? market.proposedQuoteRaw : market.proposedAssetRaw);
    await approve(market.token0, npm, amount0Desired);
    await approve(market.token1, npm, amount1Desired);
    const params = { token0: market.token0, token1: market.token1, fee: market.fee, tickLower: market.tickLower, tickUpper: market.tickUpper,
      amount0Desired, amount1Desired, amount0Min: 0n, amount1Min: 0n, recipient, deadline: (await client.getBlock()).timestamp + 1200n };
    const preview = (await client.simulateContract({ address: npm, abi: npmAbi, functionName: "mint", args: [params], account })).result;
    if (preview[1] === 0n || preview[2] === 0n || preview[3] === 0n) throw new Error("Rounded liquidity or token amounts are zero");
    params.amount0Min = preview[2] * 99n / 100n;
    params.amount1Min = preview[3] * 99n / 100n;
    const { receipt } = await send(npm, npmAbi, "mint", [params]);
    const minted = parseEventLogs({ abi: npmAbi, eventName: "IncreaseLiquidity", logs: receipt.logs }).find((event) => event.address.toLowerCase() === npm.toLowerCase());
    if (!minted || minted.args.liquidity === 0n) throw new Error("No minted position in receipt");
    await approve(market.token0, npm, 0n);
    await approve(market.token1, npm, 0n);
    const liquidity = await client.readContract({ address: market.address, abi: poolAbi, functionName: "liquidity" });
    if (liquidity === 0n) throw new Error("Pool has no active liquidity after mint");
    const quotes = [];
    const snapshot = mode === "simulate" ? await client.request({ method: "evm_snapshot" }) : undefined;
    const smokeStart = transactions.length;
    for (const [tokenIn, tokenOut, amountIn] of [[market.token0, market.token1, amount0Desired / 100n], [market.token1, market.token0, amount1Desired / 100n]]) {
      const path = concatHex([tokenIn, numberToHex(market.fee, { size: 3 }), tokenOut]);
      const quoteResult = (await client.simulateContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInput", args: [path, amountIn] })).result;
      if (quoteResult[0] === 0n) throw new Error("Seeded pool quote is zero");
      if (mode === "simulate") {
        // Swap smoke tests spend separate local-only input after the seed budget is deposited.
        if (tokenIn.toLowerCase() === plan.protocolWeth.toLowerCase()) {
          const available = await client.readContract({ address: tokenIn, abi: erc20, functionName: "balanceOf", args: [recipient] });
          if (available < amountIn) await send(tokenIn, erc20, "deposit", [], amountIn - available);
        }
        await approve(tokenIn, router, amountIn);
        await send(router, routerAbi, "exactInput", [{ path, recipient, amountIn, amountOutMinimum: quoteResult[0] * 99n / 100n }]);
        await approve(tokenIn, router, 0n);
      }
      quotes.push({ tokenIn, tokenOut, amountIn, amountOut: quoteResult[0], swapExecutedLocally: mode === "simulate" });
    }
    if (snapshot) {
      await client.request({ method: "evm_revert", params: [snapshot] });
      for (const transaction of transactions.slice(smokeStart)) transaction.simulationOnly = true;
    }
    results.push({ id: market.id, address: market.address, sqrtPriceX96: sqrt, priceUsdg: market.priceUsdg, liquidity,
      tokenId: minted.args.tokenId, mintedLiquidity: minted.args.liquidity, amount0: minted.args.amount0, amount1: minted.args.amount1,
      mintTransactionHash: receipt.transactionHash, quotes });
    save();
    console.log(`${market.id}: liquidity ${liquidity}, position ${minted.args.tokenId}, quotes passed`);
  }
} finally {
  for (const [token, spender] of allowances.values()) await approve(token, spender, 0n);
  save();
}
console.log(`Completed ${mode}; ${results.length} pools. Receipts are in ${receiptPath}`);
