import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, parseAbi, concatHex, numberToHex, maxUint256 } = require("viem");
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const deploymentFile = process.env.FLOW_DEPLOYMENT_FILE || "test-results/v3-auth/protocol-simulation.json";
const config = read(deploymentFile);
const markets = read("scripts/fixtures/robinhood-testnet-v3.json");
const rpc = process.env.TESTNET_RPC_URL || "http://127.0.0.1:8547";
const chain = { id: 46630, name: "Local Robinhood fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc) });
assert(["127.0.0.1", "localhost"].includes(new URL(rpc).hostname));
assert.equal(await client.getChainId(), 46630);
assert((await client.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil"));
await verifyTestnetRoutingRuntime(client, config, read("scripts/fixtures/robinhood-testnet-routing.json"));
const account = config.deployer;
await client.request({ method: "anvil_impersonateAccount", params: [account] });
const wallet = createWalletClient({ chain, account, transport: http(rpc) });
const snapshot = await client.request({ method: "evm_snapshot" });
const abi = (name) => read(`contracts/out/${name}.sol/${name}.json`).abi;
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const permit2Abi = parseAbi(["function allowance(address,address,address) view returns (uint160,uint48,uint48)"]);
const factory = config.contracts.factory.address;
const router = config.contracts.entryRouter.address;
const adapter = config.contracts.uniswapV3Adapter.address;
const collector = config.contracts.buybackCollector.address;
const otf = config.contracts.otfToken.address;
const weth = config.externalContracts.weth;
const usdg = markets.markets[0].quoteAddress;
const constituents = markets.markets.filter((market) => market.asset !== "WETH");
const receipts = [];
const tests = [];
const readToken = (address, functionName, args = []) => client.readContract({ address, abi: erc20, functionName, args });
const deadline = async () => (await client.getBlock()).timestamp + 600n;
const path = (tokens, fees) => concatHex(tokens.flatMap((token, index) => index === 0 ? [token] : [numberToHex(fees[index - 1], { size: 3 }), token]));
async function send(address, contractAbi, functionName, args = [], value = 0n) {
  const preview = await client.simulateContract({ address, abi: contractAbi, functionName, args, value, account });
  const gas = (await client.estimateContractGas({ address, abi: contractAbi, functionName, args, value, account })) * 125n / 100n + 50_000n;
  const hash = await wallet.writeContract({ ...preview.request, gas, gasPrice: BigInt(markets.gasPriceWei) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", functionName);
  receipts.push({ functionName, transactionHash: hash, gasUsed: receipt.gasUsed });
  return preview.result;
}
async function cleared() {
  for (const token of [weth, usdg, ...constituents.map((market) => market.assetAddress)]) {
    assert.equal(await readToken(token, "balanceOf", [router]), 0n, "router transient balance");
    assert.equal(await readToken(token, "balanceOf", [adapter]), 0n, "adapter transient balance");
    assert.equal(await readToken(token, "allowance", [adapter, config.externalContracts.uniswapV3SwapRouter02]), 0n, "adapter approval");
  }
}
const legsIn = (native) => constituents.map((market) => ({ adapter, tokenIn: native ? weth : usdg, tokenOut: market.assetAddress,
  amountIn: native ? 200_000_000_000_000n : 200_000n, minAmountOut: 1n,
  data: native ? path([weth, usdg, market.assetAddress], [markets.markets[0].fee, market.fee]) : path([usdg, market.assetAddress], [market.fee]) }));
const legsOut = (native) => constituents.map((market) => ({ adapter, tokenIn: market.assetAddress, tokenOut: native ? weth : usdg,
  amountIn: maxUint256, minAmountOut: 1n,
  data: native ? path([market.assetAddress, usdg, weth], [market.fee, markets.markets[0].fee]) : path([market.assetAddress, usdg], [market.fee]) }));
try {
  const vault = await send(factory, abi("OTFFactory"), "createVault", [{ name: "Five-market V3 validation", symbol: "V3TEST",
    fundThesis: "Local testnet validation of the five configured constituent markets.", expenseBeneficiary: account,
    annualCreatorExpenseRatioBps: 0, mintFeeBps: 200, redeemFeeBps: 0,
    constituents: constituents.map((market) => market.assetAddress), bootstrapBasketUnitsPerOTF: constituents.map(() => 10n ** 17n) }]);
  await send(usdg, erc20, "approve", [router, 1_000_000n]);
  await send(router, abi("OTFEntryExitRouter"), "mintFromToken", [{ inputToken: usdg, vault, amountIn: 1_000_000n, minShares: 1n, deadline: await deadline() }, legsIn(false)]);
  const shares = await readToken(vault, "balanceOf", [account]);
  assert(shares > 0n);
  await cleared();
  tests.push("Five real constituent pools: USDG basket entry and allowance cleanup");
  await send(vault, erc20, "approve", [router, shares]);
  const beforeExit = await readToken(usdg, "balanceOf", [account]);
  await send(router, abi("OTFEntryExitRouter"), "redeemToToken", [{ vault, outputToken: usdg, shares, minAmountOut: 1n, skipMask: 0n, deadline: await deadline() }, constituents.map(() => 0n), legsOut(false)]);
  assert(await readToken(usdg, "balanceOf", [account]) > beforeExit);
  await cleared();
  tests.push("Five real constituent pools: USDG basket exit");
  await send(router, abi("OTFEntryExitRouter"), "mintFromNative", [{ inputToken: weth, vault, amountIn: 1_000_000_000_000_000n, minShares: 1n, deadline: await deadline() }, legsIn(true)], 1_000_000_000_000_000n);
  const nativeShares = await readToken(vault, "balanceOf", [account]);
  assert(nativeShares > 0n);
  await cleared();
  await send(vault, erc20, "approve", [router, nativeShares]);
  const beforeNative = await client.getBalance({ address: account });
  await send(router, abi("OTFEntryExitRouter"), "redeemToNative", [{ vault, outputToken: weth, shares: nativeShares, minAmountOut: 1n, skipMask: 0n, deadline: await deadline() }, constituents.map(() => 0n), legsOut(true)]);
  assert(await client.getBalance({ address: account }) > beforeNative);
  await cleared();
  tests.push("Native entry/exit uses protocol WETH and the supporting WETH/USDG pool");
  const beforeSupply = await readToken(otf, "totalSupply");
  await send(collector, abi("BuybackCollector"), "settleFeesViaRedemption", [vault, constituents.map(() => 0n), 0n, legsOut(true), 1n, 1n, await deadline()]);
  assert(await readToken(otf, "totalSupply") < beforeSupply);
  const fees = await client.readContract({ address: collector, abi: abi("BuybackCollector"), functionName: "feeAccounts", args: [vault] });
  assert.equal(fees[0] + fees[1], 0n);
  assert.equal(await readToken(weth, "balanceOf", [collector]), 0n);
  assert.equal(await readToken(otf, "balanceOf", [collector]), 0n);
  assert.equal(await readToken(weth, "allowance", [collector, config.externalContracts.permit2]), 0n);
  const permit = await client.readContract({ address: config.externalContracts.permit2, abi: permit2Abi, functionName: "allowance", args: [collector, weth, config.externalContracts.uniswapUniversalRouter] });
  assert.equal(permit[0], 0n);
  await cleared();
  tests.push("Collector redemption settlement, canonical OTF buyback/burn, and ERC-20/Permit2 cleanup");
  await send(usdg, erc20, "approve", [router, 1_000_000n]);
  const beforeFailure = await readToken(usdg, "balanceOf", [account]);
  const badLegs = legsIn(false);
  badLegs[0].minAmountOut = maxUint256;
  await assert.rejects(client.simulateContract({ address: router, abi: abi("OTFEntryExitRouter"), functionName: "mintFromToken", args: [{ inputToken: usdg, vault, amountIn: 1_000_000n, minShares: 1n, deadline: await deadline() }, badLegs], account }));
  assert.equal(await readToken(usdg, "balanceOf", [account]), beforeFailure);
  await send(usdg, erc20, "approve", [router, 0n]);
  await cleared();
  tests.push("Minimum-output rejection preserves balances and clears wallet approval");
  const output = deploymentFile.startsWith("app/") ? "live-deployment-fork-flows" : "real-basket-flows";
  writeFileSync(resolve(root, `test-results/v3-auth/${output}.json`), JSON.stringify({ chainId: 46630, simulation: true, deploymentFile, result: "passed", vault, tests, receipts }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
  console.log(tests.join("\n"));
} finally {
  await client.request({ method: "evm_revert", params: [snapshot] });
}
