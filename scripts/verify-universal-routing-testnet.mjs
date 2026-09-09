import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readDeploymentAssetCatalog } from "./lib/registry.mjs";
import { verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";
import { v3PoolInitCodeHash } from "./lib/universal-router.mjs";

const { createPublicClient,http,parseAbi,getAddress,getCreate2Address,keccak256,encodeAbiParameters,parseAbiParameters } = createRequire(new URL("../app/package.json",import.meta.url))("viem");
const read = path => JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const config = read("../app/src/config/robinhood-testnet.json");
const client = createPublicClient({transport:http(process.env.TESTNET_RPC_URL || config.rpcUrl)});
await verifyTestnetRoutingRuntime(client,config,read("./fixtures/robinhood-testnet-routing.json"));
const catalog = await readDeploymentAssetCatalog(46630);
const c = config.externalContracts;
const d = Object.fromEntries(Object.entries(config.contracts).map(([name,value])=>[name,value.address]));
const bindings = parseAbi(["function factory() view returns(address)","function entryExitRouter() view returns(address)","function buybackCollector() view returns(address)","function weth() view returns(address)","function uniswapV3Factory() view returns(address)","function uniswapV4PoolManager() view returns(address)","function uniswapV4StateView() view returns(address)","function uniswapUniversalRouter() view returns(address)","function permit2() view returns(address)","function v3PoolInitCodeHash() view returns(bytes32)","function isAdapterApproved(address) view returns(bool)","function isVault(address) view returns(bool)","function token0() view returns(address)","function token1() view returns(address)","function fee() view returns(uint24)","function liquidity() view returns(uint128)","function getPool(address,address,uint24) view returns(address)"]);
const call = (address,functionName,args=[])=>client.readContract({address,abi:bindings,functionName,args});
const check = async(address,method,expected)=>assert.equal(getAddress(await call(address,method)),getAddress(expected),method);
for (const address of Object.values(d)) assert((await client.getCode({address}))?.length>2,"Missing protocol code");
for (const [address,method,expected] of [[d.factory,"entryExitRouter",d.entryRouter],[d.factory,"buybackCollector",d.buybackCollector],[d.buybackCollector,"factory",d.factory],[d.entryRouter,"factory",d.factory],[d.entryRouter,"weth",c.weth],
  ...Object.entries({entryExitRouter:d.entryRouter,weth:c.weth,uniswapV3Factory:c.uniswapV3Factory,uniswapV4PoolManager:c.uniswapV4PoolManager,uniswapV4StateView:c.uniswapV4StateView,uniswapUniversalRouter:c.uniswapUniversalRouter,permit2:c.permit2}).map(([method,expected])=>[d.uniswapUniversalRouterAdapter,method,expected])]) await check(address,method,expected);
assert.equal(await call(d.uniswapUniversalRouterAdapter,"v3PoolInitCodeHash"),v3PoolInitCodeHash);
assert.equal(await call(d.entryRouter,"isAdapterApproved",[d.uniswapUniversalRouterAdapter]),true);
for (const {address} of config.sampleOtfs) {
  assert.equal(await call(d.factory,"isVault",[address]),true);
  await check(address,"entryExitRouter",d.entryRouter);
  await check(address,"buybackCollector",d.buybackCollector);
}
const tokens = [...catalog.quoteAssets,...catalog.fundAssets];
for (const pool of catalog.pools) {
  const ordered = [tokens.find(token=>token.id===pool.assetA).address,tokens.find(token=>token.id===pool.assetB).address].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  const expected = getCreate2Address({from:c.uniswapV3Factory,salt:keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24"),[...ordered,pool.fee])),bytecodeHash:v3PoolInitCodeHash});
  assert.equal(getAddress(pool.address),expected);
  assert.equal(getAddress(await call(c.uniswapV3Factory,"getPool",[...ordered,pool.fee])),expected);
  await check(pool.address,"factory",c.uniswapV3Factory);await check(pool.address,"token0",ordered[0]);await check(pool.address,"token1",ordered[1]);
  assert.equal(await call(pool.address,"fee"),pool.fee);assert(await call(pool.address,"liquidity")>0n);
}
console.log(`Verified Universal Router release and bindings, ${config.sampleOtfs.length} vaults, and ${catalog.pools.length} registered V3 pools on chain 46630.`);
