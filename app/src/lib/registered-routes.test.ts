import {describe,expect,it,vi} from "vitest";
import {decodeAbiParameters,decodeFunctionData,parseAbiParameters,zeroAddress,type Address} from "viem";
import {registeredCandidates,routeSegments,v4QuotePath,quoteRegisteredPath,bestRegisteredQuote,registeredBasketRoutes,type RouteSegment} from "./registered-routes";
import type {CatalogAsset,RegisteredPool} from "./asset-catalog";
import {registeredDirectExecution} from "./registered-direct-execution";
import {UNIVERSAL_ROUTER_EXECUTE_ABI} from "./canonical-v4-execution";
const addr=(i:number)=>`0x${i.toString(16).padStart(40,"0")}` as Address;
const asset=(i:number):CatalogAsset=>({id:String(i),chainId:4663,address:addr(i),symbol:String(i),name:String(i),decimals:18,assetType:"other",enabled:true,verified:false,featured:false});
const pool=(id:number,a:number,b:number,version:3|4=3):RegisteredPool=>({id:String(id),chainId:4663,venue:"uniswap",protocolVersion:version,assetA:asset(a),assetB:asset(b),fee:3000,tickSpacing:60,hooks:zeroAddress,hookData:"0x",approved:true,enabled:true,validationMetadata:{}});
describe("registered multi-pool routing",()=>{
  const pools=[pool(1,1,2),pool(2,1,2),pool(3,1,3),pool(4,3,2,4)];
  const paths=registeredCandidates(pools,4663,addr(1),addr(2),addr(3));
  const authenticate=vi.fn(async()=>{});
  it("compares exact amounts across competing direct and mixed two-hop routes",async()=>{
    expect(paths).toHaveLength(3);
    const quoteSegment=async(s:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint)=>({amount:type==="EXACT_INPUT"?amount*BigInt(s.hops[0].pool.id):amount/BigInt(s.hops[0].pool.id),gas:100n});
    const input=await bestRegisteredQuote({paths,type:"EXACT_INPUT",amount:12_000n,authenticate,quoteSegment});
    expect(input?.amountOut).toBe(144_000n);
    expect(input?.path.map(h=>h.pool.id)).toEqual(["3","4"]);
    const output=await bestRegisteredQuote({paths,type:"EXACT_OUTPUT",amount:12_000n,authenticate,quoteSegment});
    expect(output?.amountIn).toBe(1_000n);
    expect(output?.values).toEqual([{amountIn:1000n,amountOut:3000n},{amountIn:3000n,amountOut:12000n}]);
  });
  it("quotes exact output in reverse segment order and keeps V4 pool order",async()=>{
    const path=registeredCandidates([pool(1,1,2,4),pool(2,2,3,4)],4663,addr(1),addr(3),addr(9))[0];
    const segment=routeSegments(path)[0];
    expect(v4QuotePath(segment,true).map(p=>p.intermediateCurrency)).toEqual([addr(1),addr(2)]);
    expect(v4QuotePath(segment).map(p=>p.intermediateCurrency)).toEqual([addr(2),addr(3)]);
    const call=vi.fn(async(_s:RouteSegment,_type:string,amount:bigint)=>({amount:amount/2n}));
    await quoteRegisteredPath(paths[2],"EXACT_OUTPUT",4000n,call);
    expect(call.mock.calls.map(([s,,amount])=>[s.version,amount])).toEqual([[4,4000n],[3,2000n]]);
  });
  it("uses reliable gas costs only when every compared candidate has a conversion",async()=>{
    const best=await bestRegisteredQuote({paths:paths.slice(0,2),type:"EXACT_INPUT",amount:10000n,authenticate,
      quoteSegment:async(s,_type,amount)=>({amount:amount+BigInt(s.hops[0].pool.id)*amount/100n,gas:s.hops[0].pool.id==="2"?1000n:1n}),gasCostInQuoteToken:async gas=>gas});
    expect(best?.path[0].pool.id).toBe("1");
  });
  it.each(["missing","failed","impact","size"])("uses Trading API fallback for %s candidates",async reason=>{
    const fallback={quote:vi.fn(async()=>({amountIn:10000n,amountOut:19000n,legs:[]}))};
    const routes=registeredBasketRoutes({pools:reason==="missing"?[]:pools.slice(0,1),chainId:4663,weth:addr(3),adapter:addr(9),slippageBps:50,fallback,
      authenticate:async()=>{if(reason==="failed")throw new Error("unavailable");},withinTradeSize:async()=>reason!=="size",
      quoteSegment:async(_s,_type,amount)=>({amount:reason==="impact" && amount===10000n?amount:amount*2n})});
    const first=routes.quote("EXACT_INPUT",addr(1),addr(2),10000n);
    expect(routes.quote("EXACT_INPUT",addr(1),addr(2),10000n)).toBe(first);
    expect((await first).amountOut).toBe(19000n);
    expect(fallback.quote).toHaveBeenCalledTimes(1);
  });
  it("handles native/WETH between versions and encodes the complete V4 2.1.1 swap",()=>{
    const nativePool=pool(4,0,2,4);
    const path=registeredCandidates([pool(3,1,3),nativePool],4663,addr(1),addr(2),addr(3))[0];
    const tx=registeredDirectExecution({path,weth:addr(3),tokenIn:addr(1),tokenOut:addr(2),amountIn:10000n,minimumOut:19000n,nativeInput:false,nativeOutput:false,deadline:123n});
    const decoded=decodeFunctionData({abi:UNIVERSAL_ROUTER_EXECUTE_ABI,data:tx.data});
    expect(decoded.args[0]).toContain("02000c10");
    const [actions,parameters]=decodeAbiParameters(parseAbiParameters("bytes,bytes[]"),decoded.args[1][3]);
    expect(actions).toBe("0x0b070e0e");
    const [swap]=decodeAbiParameters(parseAbiParameters("(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amountIn,uint128 amountOutMinimum)"),parameters[1]);
    expect(swap.currencyIn).toBe(zeroAddress);expect(swap.amountIn).toBe(0n);expect(swap.minHopPriceX36).toEqual([]);
    expect(tx.value).toBe(0n);
  });
});

describe("shared mint prefixes", () => {
  const make = (reason?: string, version: 3 | 4 = 3) => {
    const shared = { ...pool(1,1,2,version), address: addr(101) };
    const leaves = [3,4,5,6,7].map(i => ({ ...pool(i,2,i,version), address:addr(100+i) }));
    if (reason === "hook") shared.hooks = addr(77);
    const quoteSegment = vi.fn(async (segment:RouteSegment, type:"EXACT_INPUT"|"EXACT_OUTPUT", amount:bigint) => {
      if (segment.hops.length === 1 && segment.hops[0].pool.id === "1" && amount > 40_000n) {
        if (reason === "failed") throw new Error("quote unavailable");
        if (reason === "worse") return { amount:amount/2n };
      }
      return { amount };
    });
    return { routes:registeredBasketRoutes({pools:[shared,...leaves],chainId:4663,weth:addr(9),adapter:addr(90),slippageBps:50,
      authenticate:async()=>{},withinTradeSize:async()=>reason!=="size",quoteSegment}),quoteSegment };
  };
  it.each([3,4] as const)("combines five V%s two-hop routes into six swaps with bounded allocations", async version => {
    const {routes,quoteSegment}=make(undefined,version);
    const original=(await Promise.all([3,4,5,6,7].map(i=>routes.quote("EXACT_OUTPUT",addr(1),addr(i),10_001n)))).flatMap(q=>q.legs);
    const merged=await routes.optimizeMint!(original);
    expect(merged).toHaveLength(6);
    expect(merged.reduce((count,leg)=>count+leg.hops.length,0)).toBe(6);
    expect(merged[0].amountIn).toBe(original.reduce((sum,leg)=>sum+leg.amountIn,0n));
    expect(merged.slice(1).reduce((sum,leg)=>sum+leg.amountIn,0n)).toBe(merged[0].minAmountOut);
    expect(merged.slice(1).map(leg=>leg.minAmountOut)).toEqual(original.map(leg=>leg.minAmountOut));
    expect(merged.slice(1).every(leg=>leg.amountIn>=leg.minAmountOut)).toBe(true);
    expect(quoteSegment.mock.calls.some(([s,t,a])=>s.hops.length===1 && t==="EXACT_INPUT" && a===merged[0].amountIn)).toBe(true);
  });
  it.each(["hook","failed","worse"])("retains the complete original plan for %s combined routes", async reason => {
    const {routes}=make(reason,reason==="hook"?4:3);
    const original=(await Promise.all([3,4,5,6,7].map(i=>routes.quote("EXACT_OUTPUT",addr(1),addr(i),10_001n)))).flatMap(q=>q.legs);
    expect(await routes.optimizeMint!(original)).toBe(original);
  });
  it("does not merge repeated downstream pools or unrelated legs", async()=>{
    const {routes}=make();
    const first=await routes.quote("EXACT_OUTPUT",addr(1),addr(3),10_001n);
    const repeated=[first.legs[0],first.legs[0]];
    expect(await routes.optimizeMint!(repeated)).toBe(repeated);
    const copied=first.legs.map(leg=>({...leg}));
    expect(await routes.optimizeMint!(copied)).toBe(copied);
  });
});
