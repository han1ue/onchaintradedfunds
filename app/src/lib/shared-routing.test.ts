import { describe, expect, it, vi } from "vitest";
import { maxUint256, zeroAddress, type Address } from "viem";
import { quoteBasketSwap } from "./basket-quote-api";
import type { BasketDeployment, BasketQuoteClient } from "./basket-client";
import type { BasketPlannerRequest } from "./basket-planner";
import type { AssetRegistry, CatalogAsset, RegisteredPool } from "./asset-catalog";
import { registeredBasketRoutes, type RouteSegment } from "./registered-routes";
import { v4PoolId } from "./v4-route";
import { QuoteFailure } from "./quote-errors";

const addr = (n: number) => `0x${n.toString(16).padStart(40,"0")}` as Address;
const A = addr(1), B = addr(2), C = addr(3), USDG = addr(4), WETH = addr(5), VAULT = addr(6), TARGET = addr(7), CALLER = addr(8);
const now = 1_750_000_000_000;
const deployment = { factory: addr(10), entryRouter: addr(11), uniswapUniversalRouterAdapter: addr(12), weth: WETH,
  uniswapV3Factory: addr(13), uniswapV4PoolManager: addr(14), uniswapV4StateView: addr(15), uniswapV4Quoter: addr(16),
  universalRouter: addr(17), permit2: addr(18), otfToken: addr(19), launchManager: addr(20) } satisfies BasketDeployment;
function fixture(chainId: number, version: 3 | 4 = 3) {
  const asset = (address: Address): CatalogAsset => ({ id: address, chainId, address, decimals: 18, symbol: address, name: address,
    enabled: true, verified: false, featured: false, assetType: "other" });
  const pool = (id: number, from: Address, to: Address): RegisteredPool => ({
    id: String(id), chainId, assetA: asset(from), assetB: asset(to), protocolVersion: version, venue: "uniswap", fee: 3000,
    address: version === 3 ? addr(100 + id) : undefined, poolManager: version === 4 ? deployment.uniswapV4PoolManager : undefined,
    poolId: version === 4 ? v4PoolId(from, { intermediateCurrency: to, fee: 3000, tickSpacing: 60, hooks: zeroAddress, hookData: "0x" }) : undefined,
    hooks: version === 4 ? zeroAddress : undefined, tickSpacing: version === 4 ? 60 : undefined,
    hookData: "0x", approved: true, enabled: true, validationMetadata: {},
  });
  const registry: AssetRegistry = { assets: [A,B,C,USDG,WETH].map(asset), pools: [pool(1,A,USDG),pool(2,B,USDG),pool(3,USDG,WETH)] };
  const request: BasketPlannerRequest = { route: "basket", chainId, caller: CALLER,
    input: {address:VAULT,decimals:18,kind:"otf",isFactoryVault:true}, output:{address:WETH,decimals:18,kind:"erc20",isFactoryVault:false},
    inputAmountRaw: 100_000n, slippageBps: 50, requestedAtMs: now - 1000 };
  const client: BasketQuoteClient = {
    verifyBindings: vi.fn(async()=>{}), isVault: vi.fn(async()=>true), decimals: vi.fn(async()=>18),
    authenticatePool: vi.fn(async()=>{}), authenticateV4Pool: vi.fn(async()=>{}),
    verifyOtfBindings: vi.fn(async()=>{}), quoteOtf: vi.fn(async(_type,_buy,amount)=>amount),
    vaultAssets: vi.fn(async()=>[A,B]), previewRedeem: vi.fn(async()=>[50_000n,50_000n]),
    previewMint: vi.fn(async(_vault,shares)=>[shares/2n,shares-shares/2n]),
    simulate: vi.fn(async execution=>({amountOut:execution.call.method === "swapBasketToBasket" ? execution.call.args[0].minSharesOut : 100_000n, refunds:[{token:USDG,amount:500n}],gasUsed:123n})),
  };
  const routing = { authenticate: vi.fn(async()=>{}), withinTradeSize: vi.fn(async()=>true),
    quoteSegment: vi.fn(async(_segment:RouteSegment,_type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint)=>({amount,gas:10n})) };
  return { request, client, registry, routing, pool, dependencies: { deployment, client, registry, registeredClient: routing, now:()=>now } };
}
type ResultBody = { state:string; execution: { legs: { tokenIn:Address;tokenOut:Address;amountIn:string;minAmountOut:string }[] }; gasEstimate:string; residualRefunds:unknown[] };

describe.each([4663,46630])("shared basket behavior on %s", chainId => {
  it.each([3,4] as const)("combines exactly one compatible V%s USDG/WETH exit with unverified enabled assets",async version=>{
    const f=fixture(chainId,version), provider=vi.fn();
    const result=await quoteBasketSwap(f.request,{...f.dependencies,requestQuote:provider});
    expect(result.status).toBe(200);
    const body=result.body as unknown as ResultBody;
    expect(body.execution.legs.map(leg=>[leg.tokenIn,leg.tokenOut])).toEqual([[A,USDG],[B,USDG],[USDG,WETH]]);
    expect(body.execution.legs.map(leg=>BigInt(leg.amountIn))).toEqual([50_000n,50_000n,99_750n]);
    expect(f.routing.quoteSegment).toHaveBeenCalledWith(expect.objectContaining({tokens:[USDG,WETH]}),"EXACT_INPUT",99_750n);
    expect(f.client.simulate).toHaveBeenCalledOnce();
    expect(body.gasEstimate).toBe("123");expect(body.residualRefunds).toHaveLength(1);expect(provider).not.toHaveBeenCalled();
  });
  it("includes a constituent that is also the shared intermediate without spending it twice",async()=>{
    const f=fixture(chainId);f.client.vaultAssets=async()=>[A,USDG];
    const result=await quoteBasketSwap(f.request,f.dependencies);
    expect(result.status).toBe(200);
    const legs=(result.body as unknown as ResultBody).execution.legs;
    expect(legs.map(leg=>[leg.tokenIn,leg.tokenOut])).toEqual([[A,USDG],[USDG,WETH]]);
    expect(BigInt(legs[1]!.amountIn)).toBe(99_875n);
    expect(legs.every(leg=>BigInt(leg.amountIn)!==maxUint256)).toBe(true);
  });
  it("uses WETH for fund-to-fund settlement and the requested token for redemptions",async()=>{
    const f=fixture(chainId);f.request.output={...f.request.input,address:TARGET};
    const result=await quoteBasketSwap(f.request,f.dependencies);
    expect(result.status).toBe(200);
    const legs=(result.body as unknown as ResultBody).execution.legs;
    expect(legs.some(leg=>leg.tokenOut===WETH)).toBe(true);expect(legs.some(leg=>leg.tokenIn===WETH)).toBe(true);
    f.request.output={address:USDG,decimals:18,kind:"erc20",isFactoryVault:false};
    const redemption=await quoteBasketSwap(f.request,f.dependencies);
    expect((redemption.body as unknown as ResultBody).execution.legs.every(leg=>leg.tokenOut===USDG)).toBe(true);
  });
  it("uses the nonlinear combined quote and retains the original constituent minimums",async()=>{
    const f=fixture(chainId);
    f.routing.quoteSegment.mockImplementation(async(segment,_type,amount)=>({
      amount:segment.tokens[0]===USDG && amount===99_750n ? 99_600n : amount,gas:10n,
    }));
    const result=await quoteBasketSwap(f.request,f.dependencies);
    expect(result.status).toBe(200);
    const legs=(result.body as unknown as ResultBody).execution.legs;
    expect(legs).toHaveLength(3);
    expect(BigInt(legs[2]!.minAmountOut)).toBe(99_500n);
    expect(result.body).toMatchObject({expectedOutputRaw:"99600"});
  });
  it.each(["hook","dynamic"])("leaves %s V4 exits separate",async unsafe=>{
    const f=fixture(chainId,4);
    if(unsafe==="hook") f.registry.pools[2]!.hooks=addr(99); else f.registry.pools[2]!.fee=0x800000;
    const result=await quoteBasketSwap(f.request,f.dependencies);
    expect(result.status).toBe(200);
    expect((result.body as unknown as ResultBody).execution.legs).toHaveLength(2);
  });
  it("retains native basket entry/exit and canonical OTF constituents",async()=>{
    const f=fixture(chainId);f.client.vaultAssets=async()=>[deployment.otfToken!,A];
    f.request.output.kind="native";
    const result=await quoteBasketSwap(f.request,f.dependencies);
    expect(result.status).toBe(200);expect(f.client.quoteOtf).toHaveBeenCalled();expect(f.client.verifyOtfBindings).toHaveBeenCalled();
    expect(result.body).toMatchObject({execution:{method:"redeemToNative",nativeValue:"0"}});
  });
  it.each(["no-route","revoked","liquidity","simulation","expired","metadata"])("returns unavailable for %s without retrying the plan",async failure=>{
    const f=fixture(chainId), provider=vi.fn();
    if(failure==="no-route"){f.registry.assets.forEach(asset=>asset.verified=true);f.registry.pools=[];}
    if(failure==="revoked") f.registry.pools.forEach(pool=>pool.approved=false);
    if(failure==="liquidity") f.routing.quoteSegment.mockRejectedValue(new QuoteFailure("NO_LIQUIDITY"));
    if(failure==="simulation") f.client.simulate=vi.fn(async()=>{throw new QuoteFailure("SIMULATION_FAILED");});
    if(failure==="metadata") f.client.isVault=async()=>false;
    const clock=failure==="expired"?vi.fn().mockReturnValueOnce(now).mockReturnValue(now+46_000):()=>now;
    expect((await quoteBasketSwap(f.request,{...f.dependencies,now:clock})).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });
  it("keeps mixed and hooked routes separate and excludes reserved version boundaries",async()=>{
    const f=fixture(chainId,4);f.registry.pools[0]!.protocolVersion=3;f.registry.pools[1]!.hooks=addr(44);
    const routes=registeredBasketRoutes({pools:f.registry.pools,chainId,weth:WETH,adapter:deployment.uniswapUniversalRouterAdapter,slippageBps:50,...f.routing});
    const quotes=await Promise.all([A,B].map(token=>routes.quote("EXACT_INPUT",token,WETH,50_000n)));
    expect((await routes.optimizeExit!(quotes)).legs).toHaveLength(3);
    const reserved=registeredBasketRoutes({pools:f.registry.pools,chainId,weth:WETH,adapter:deployment.uniswapUniversalRouterAdapter,slippageBps:50,reservedTokens:[USDG],...f.routing});
    await expect(reserved.quote("EXACT_INPUT",A,WETH,50_000n)).rejects.toThrow();
  });
});

describe("one API discovery for a missing constituent",()=>{
  it.each([false,true])("keeps C in the basket transaction (separate=%s)",async separate=>{
    const f=fixture(4663);f.client.vaultAssets=async()=>[A,B,C];f.client.previewRedeem=async()=>[30_000n,30_000n,40_000n];
    const hop=(from:Address,to:Address,pool:Address)=>({type:"v3-pool",address:pool,fee:"3000",tokenIn:{address:from,chainId:4663},tokenOut:{address:to,chainId:4663},amountIn:"40000",amountOut:"40000"});
    const requestQuote=vi.fn(async()=>({routing:"CLASSIC",quote:{chainId:4663,tradeType:"EXACT_INPUT",swapper:deployment.entryRouter,
      input:{token:C,amount:"40000"},output:{token:WETH,amount:"40000",recipient:deployment.entryRouter},
      route:[separate?[hop(C,WETH,addr(200))]:[hop(C,USDG,addr(200)),hop(USDG,WETH,addr(103))]]}}));
    const result=await quoteBasketSwap(f.request,{...f.dependencies,requestQuote});
    expect(result.status).toBe(200);expect(requestQuote).toHaveBeenCalledOnce();
    expect(requestQuote).toHaveBeenCalledWith(expect.objectContaining({tokenIn:C,tokenOut:WETH}));
    const legs=(result.body as unknown as ResultBody).execution.legs;
    expect(legs.filter(leg=>leg.tokenIn===USDG&&leg.tokenOut===WETH)).toHaveLength(1);
    expect(legs.some(leg=>leg.tokenIn===C&&leg.tokenOut===(separate?WETH:USDG))).toBe(true);
    expect(f.client.simulate).toHaveBeenCalledOnce();
  });
  it("never calls the provider on testnet, even when a fallback callback is supplied",async()=>{
    const f=fixture(46630);f.registry.pools=[];const requestQuote=vi.fn();
    expect((await quoteBasketSwap(f.request,{...f.dependencies,requestQuote})).status).toBe(503);
    expect(requestQuote).not.toHaveBeenCalled();
  });
});
