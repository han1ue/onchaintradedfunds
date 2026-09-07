import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const config = read("app/src/config/robinhood-mainnet.json");
const assets = read("scripts/fixtures/robinhood-mainnet-rehearsal.json");
const { createPublicClient, http, parseAbi, zeroAddress } = createRequire(new URL("../app/package.json", import.meta.url))("viem");
const rpc = createPublicClient({ transport: http(process.env.RH_MAINNET_RPC_URL?.trim() || config.rpcUrl, { timeout: 12000, retryCount: 0 }) });
const results = {};
async function check(name, run) {
  try { results[name] = { status: "passed", ...await run() }; }
  catch (error) { results[name] = { status: "failed", code: error?.code ?? "CHECK_FAILED", ...(error?.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error?.providerCode ? { providerCode: error.providerCode } : {}) }; }
}
function failed(code, httpStatus) { return Object.assign(new Error(code), { code, httpStatus }); }
await check("rpc", async () => {
  if (await rpc.getChainId() !== 4663) throw failed("WRONG_CHAIN");
  return { chainId: 4663, source: process.env.RH_MAINNET_RPC_URL ? "environment" : "public-default" };
});
await check("simulation", async () => {
  const result = await rpc.simulateCalls({ account: zeroAddress, calls: [{ to: zeroAddress, data: "0x", value: 0n }], validation: false });
  if (result.results.length !== 1 || result.results[0].status !== "success") throw failed("SIMULATION_FAILED");
  return { method: "eth_simulateV1" };
});
await check("oracle", async () => {
  const abi = parseAbi(["function decimals() view returns (uint8)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
  const [decimals, round] = await Promise.all([
    rpc.readContract({ address: config.externalContracts.ethUsdOracle, abi, functionName: "decimals" }),
    rpc.readContract({ address: config.externalContracts.ethUsdOracle, abi, functionName: "latestRoundData" }),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (decimals !== 8 || round[1] <= 0n || round[3] === 0n || round[3] > now || now - round[3] > BigInt(config.oracleValidation.maxAgeSeconds)) throw failed("ORACLE_INVALID_OR_STALE");
  return { updatedAt: String(round[3]), maxAgeSeconds: config.oracleValidation.maxAgeSeconds };
});
async function quote(tokenIn, tokenOut, type, amount) {
  await delay(1100);
  const response = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.UNISWAP_API_KEY.trim() },
    body: JSON.stringify({ type, amount, tokenInChainId: 4663, tokenOutChainId: 4663, tokenIn, tokenOut, swapper: process.env.DEPLOYER_ADDRESS?.trim() || zeroAddress, slippageTolerance: 0.5, protocols: ["V3", "V4"], routingPreference: "BEST_PRICE" }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const providerCode = typeof body.errorCode === "string" && /^[A-Z_0-9]+$/u.test(body.errorCode) ? body.errorCode : undefined;
    throw Object.assign(failed(response.status === 429 ? "UNISWAP_RATE_LIMITED" : response.status === 404 ? "UNISWAP_NO_ROUTE" : "UNISWAP_QUOTE_REJECTED", response.status), { providerCode });
  }
  const body = await response.json();
  if (body.routing !== "CLASSIC" || body.quote?.chainId !== 4663) throw failed("UNSUPPORTED_QUOTE");
}
if (!process.env.UNISWAP_API_KEY?.trim()) results.uniswap = { status: "not-configured", required: "UNISWAP_API_KEY" };
else {
  await check("uniswap", async () => {
    await quote(assets.usdg.address, assets.wethMarket.address, "EXACT_INPUT", "1000000");
    return { pair: "USDG/WETH", otfPoolVerified: false };
  });
  for (const stock of assets.stocks) {
    const amount = String(10n ** BigInt(stock.decimals) / 100n);
    await check(`uniswap-${stock.symbol}-buy`, async () => {
      await quote(assets.usdg.address, stock.address, "EXACT_OUTPUT", amount);
      return { type: "EXACT_OUTPUT", stockAmount: "0.01", executionSimulated: false };
    });
    await check(`uniswap-${stock.symbol}-sell`, async () => {
      await quote(stock.address, assets.usdg.address, "EXACT_INPUT", amount);
      return { type: "EXACT_INPUT", stockAmount: "0.01", executionSimulated: false };
    });
  }
}
await check("creationAssets", async () => {
  const response = await fetch(config.creation.assetDataEndpoint, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw failed("ASSET_SERVICE_UNAVAILABLE", response.status);
  const payload = await response.json();
  const rows = Array.isArray(payload.assets) ? payload.assets : [];
  const matched = assets.stocks.filter((stock) => rows.some((row) => row.tokenSymbol === stock.symbol
    && row.tokenDecimals === stock.decimals && row.status === "ASSET_STATUS_ACTIVE"
    && /^1(?:\.0+)?$/.test(row.currentMultiplier ?? "")
    && row.deployments?.some((deployment) => deployment.chainId === 4663 && deployment.contractAddress?.toLowerCase() === stock.address.toLowerCase())));
  if (matched.length !== assets.stocks.length) throw failed("MAINNET_STOCK_IDENTITY_MISMATCH");
  return { verifiedStockIdentities: matched.map((stock) => stock.symbol), pricingVerified: false };
});
const directory = join(root, "test-results/mainnet");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "services.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((result) => result.status !== "passed")) process.exitCode = 1;
