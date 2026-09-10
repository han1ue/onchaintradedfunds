import { maxUint256, type Address, type Hex } from "viem";
import type { RegisteredPool } from "./asset-catalog";
import { applySlippageDown, applySlippageUp, sameAddress, type BasketRouteProvider, type BasketRouteQuote } from "./basket-planner";
import { routeFrom } from "./v3-route";
import { encodeV4Path, parseV4Path, v4BoundaryToken, type V4PathKey } from "./v4-route";
import { QuoteFailure } from "./quote-errors";
import { universalRouteData } from "./universal-route";
import type { AdapterSwapLeg } from "./swap-model";
import { aggregateExitQuotes } from "./exit-aggregation";

export const REGISTERED_ROUTE_POLICY = { maxHops: 2, maxCandidates: 16, maxImpactBps: 200, maxTradeUsd: 10_000, probeDivisor: 100n } as const;
export type RegisteredHop = { pool: RegisteredPool; tokenIn: Address; tokenOut: Address };
export type RegisteredPath = RegisteredHop[];
export type RouteSegment = { version: 3 | 4; hops: RegisteredPath; tokens: Address[]; data: Hex };
export type SegmentQuote = { amount: bigint; gas?: bigint };
export type PathQuote = { path: RegisteredPath; segments: RouteSegment[]; amountIn: bigint; amountOut: bigint; gas?: bigint; impactBps: number; values: {amountIn:bigint;amountOut:bigint}[] };

export function registeredCandidates(pools: readonly RegisteredPool[], chainId: number, input: Address, output: Address, weth: Address): RegisteredPath[] {
  const boundary = (token: Address) => v4BoundaryToken(token,weth).toLowerCase();
  const eligible = pools.filter(pool => pool.chainId === chainId && pool.enabled && pool.approved && pool.venue === "uniswap" && pool.assetA.enabled && pool.assetB.enabled);
  const candidates: RegisteredPath[] = [];
  const extend = (token:Address,path:RegisteredPath,visited:Set<string>) => {
    if (path.length >= REGISTERED_ROUTE_POLICY.maxHops) return;
    for (const pool of eligible) {
      if (path.some(hop=>hop.pool.id===pool.id)) continue;
      const a=pool.assetA.address,b=pool.assetB.address;
      const tokenIn=boundary(a)===boundary(token)?a:boundary(b)===boundary(token)?b:undefined;
      if (!tokenIn) continue;
      const tokenOut=sameAddress(tokenIn,a)?b:a;
      if (visited.has(boundary(tokenOut))) continue;
      const next=[...path,{pool,tokenIn,tokenOut}];
      if (boundary(tokenOut)===boundary(output)) candidates.push(next);
      else extend(tokenOut,next,new Set([...visited,boundary(tokenOut)]));
    }
  };
  extend(input,[],new Set([boundary(input)]));
  return candidates.sort((a,b)=>a.length-b.length || a.map(h=>h.pool.id).join(":").localeCompare(b.map(h=>h.pool.id).join(":")));
}

export function v4QuotePath(segment: RouteSegment, exactOutput = false): V4PathKey[] {
  // V4 exact-output iterates the path backwards itself. Keep pool order and use each preceding currency.
  return segment.hops.map(hop=>({ intermediateCurrency:exactOutput?hop.tokenIn:hop.tokenOut,fee:hop.pool.fee,tickSpacing:hop.pool.tickSpacing!,hooks:hop.pool.hooks!,hookData:hop.pool.hookData }));
}

export function routeSegments(path:RegisteredPath): RouteSegment[] {
  const segments: RouteSegment[]=[];
  for (const hop of path) {
    let segment=segments.at(-1);
    if (!segment || segment.version!==hop.pool.protocolVersion || !sameAddress(segment.tokens.at(-1)!,hop.tokenIn)) {
      segment={version:hop.pool.protocolVersion,hops:[],tokens:[hop.tokenIn],data:"0x"}; segments.push(segment);
    }
    segment.hops.push(hop); segment.tokens.push(hop.tokenOut);
    segment.data=segment.version===3?routeFrom(segment.tokens,segment.hops.map(h=>h.pool.fee)).path:encodeV4Path(segment.tokens[0]!,v4QuotePath(segment));
  }
  return segments;
}

export async function quoteRegisteredPath(path:RegisteredPath,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint,quoteSegment:(segment:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint)=>Promise<SegmentQuote>):Promise<PathQuote> {
  if (amount<=0n) throw new QuoteFailure("NO_ROUTE");
  const segments=routeSegments(path),values=new Array<{amountIn:bigint;amountOut:bigint}>(segments.length);
  let current=amount,gas:bigint|undefined=0n;
  const indices=segments.map((_,i)=>i); if (type==="EXACT_OUTPUT") indices.reverse();
  for (const i of indices) {
    const result=await quoteSegment(segments[i]!,type,current);
    if (result.amount<=0n) throw new QuoteFailure("NO_LIQUIDITY");
    values[i]=type==="EXACT_INPUT"?{amountIn:current,amountOut:result.amount}:{amountIn:result.amount,amountOut:current};
    current=result.amount; gas=gas!==undefined && result.gas!==undefined?gas+result.gas:undefined;
  }
  return {path,segments,amountIn:values[0]!.amountIn,amountOut:values.at(-1)!.amountOut,gas,impactBps:0,values};
}

export async function bestRegisteredQuote(options:{
  paths:RegisteredPath[];type:"EXACT_INPUT"|"EXACT_OUTPUT";amount:bigint;
  quoteSegment:(segment:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint)=>Promise<SegmentQuote>;
  authenticate:(pool:RegisteredPool)=>Promise<void>;
  gasCostInQuoteToken?:(gas:bigint)=>Promise<bigint|undefined>;
}):Promise<PathQuote|undefined> {
  const results:PathQuote[]=[];
  const failures: unknown[]=[];
  // Bounded concurrency avoids a basket fan-out overwhelming its RPC.
  for (let offset=0; offset<Math.min(options.paths.length,REGISTERED_ROUTE_POLICY.maxCandidates); offset+=4) {
    const batch=await Promise.allSettled(options.paths.slice(offset,offset+4).map(async path=>{
      await Promise.all(path.map(hop=>options.authenticate(hop.pool)));
      const result=await quoteRegisteredPath(path,options.type,options.amount,options.quoteSegment);
      const probeAmount=options.amount/REGISTERED_ROUTE_POLICY.probeDivisor;
      if (!probeAmount) throw new QuoteFailure("NO_ROUTE");
      const probe=await quoteRegisteredPath(path,options.type,probeAmount,options.quoteSegment);
      const expected=options.type==="EXACT_INPUT"?probe.amountOut*options.amount/probeAmount:probe.amountIn*options.amount/probeAmount;
      const actual=options.type==="EXACT_INPUT"?result.amountOut:result.amountIn;
      if (!expected) throw new QuoteFailure("NO_ROUTE");
      const loss=options.type==="EXACT_INPUT"?expected-actual:actual-expected;
      result.impactBps=Number(loss>0n?loss*10_000n/expected:0n);
      return result;
    }));
    for (const result of batch) {
      if (result.status==="fulfilled") results.push(result.value);
      else failures.push(result.reason);
    }
  }
  if (!results.length) {
    if(failures.length)throw new AggregateError(failures,"Registered candidates failed.");
    return undefined;
  }
  const costs=await Promise.all(results.map(result=>result.gas!==undefined && options.gasCostInQuoteToken?options.gasCostInQuoteToken(result.gas):undefined));
  const compareGas=costs.every(cost=>cost!==undefined);
  return results.reduce((best,value,i)=>{
    const bestIndex=results.indexOf(best),cost=compareGas?costs[i]!:0n,bestCost=compareGas?costs[bestIndex]!:0n;
    return options.type==="EXACT_INPUT" ? value.amountOut-cost>best.amountOut-bestCost?value:best : value.amountIn+cost<best.amountIn+bestCost?value:best;
  });
}

export function registeredBasketRoutes(options:{
  pools:readonly RegisteredPool[];chainId:number;weth:Address;adapter:Address;slippageBps:number;
  reservedTokens?:readonly Address[];forbiddenTokens?:readonly Address[];
  authenticate:(pool:RegisteredPool)=>Promise<void>;
  quoteSegment:(segment:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint)=>Promise<SegmentQuote>;
  withinTradeSize:(token:Address,amount:bigint)=>Promise<boolean>;
  gasCostInQuoteToken?:(token:Address,gas:bigint)=>Promise<bigint|undefined>;
  fallback?:BasketRouteProvider;
}):BasketRouteProvider {
  const pending=new Map<string,Promise<BasketRouteQuote>>();
  const selected = new WeakMap<AdapterSwapLeg, RegisteredPath>();
  return { optimizeExit: quotes => aggregateExitQuotes(quotes, options), async optimizeMint(legs) {
    // The registry policy permits two-hop routes. Merge only a complete group of
    // independent, hookless routes with one shared prefix and distinct leaf pools.
    // Any unsupported route or failed quote retains the original executable plan.
    if (legs.length < 2 || legs.length > 20) return legs;
    const paths = legs.map(leg => selected.get(leg));
    const first = paths[0];
    if (!first || paths.some(path => !path || path.length !== 2)) return legs;
    const prefix = first[0]!;
    const identity = (hop: RegisteredHop) => `${hop.pool.chainId}:${hop.pool.protocolVersion}:${hop.pool.address ?? hop.pool.poolId}:${hop.pool.fee}:${hop.pool.tickSpacing}:${hop.pool.hooks}:${hop.tokenIn.toLowerCase()}:${hop.tokenOut.toLowerCase()}`;
    const safe = (hop: RegisteredHop) => hop.pool.protocolVersion === 3 || (hop.pool.hooks?.toLowerCase() === "0x0000000000000000000000000000000000000000" && hop.pool.hookData === "0x" && hop.pool.fee < 0x800000);
    if (paths.some(path => identity(path![0]!) !== identity(prefix) || !path!.every(safe))
      || new Set(paths.map(path => identity(path![1]!))).size !== legs.length
      || legs.some(leg => leg.amountIn === maxUint256 || !sameAddress(leg.adapter, options.adapter))
      || legs.some(leg => sameAddress(leg.tokenOut, v4BoundaryToken(prefix.tokenOut, options.weth)))
      || options.reservedTokens?.some(token => sameAddress(token, v4BoundaryToken(prefix.tokenOut, options.weth)))) return legs;
    try {
      const amount = legs.reduce((sum,leg) => sum + leg.amountIn, 0n);
      const combined = await quoteRegisteredPath([prefix], "EXACT_INPUT", amount, options.quoteSegment);
      const probeAmount = amount / REGISTERED_ROUTE_POLICY.probeDivisor;
      if (!probeAmount || !await options.withinTradeSize(legs[0]!.tokenIn, amount)) return legs;
      const probe = await quoteRegisteredPath([prefix], "EXACT_INPUT", probeAmount, options.quoteSegment);
      const expected = probe.amountOut * amount / probeAmount;
      if (!expected || (expected - combined.amountOut) * 10_000n > expected * BigInt(REGISTERED_ROUTE_POLICY.maxImpactBps)) return legs;
      const demands = await Promise.all(paths.map((path,i) => quoteRegisteredPath([path![1]!], "EXACT_OUTPUT", legs[i]!.minAmountOut, options.quoteSegment)));
      const total = demands.reduce((sum,quote) => sum + quote.amountIn, 0n);
      if (!total || combined.amountOut < total) return legs;
      // Split quoted headroom between the prefix minimum and downstream budgets.
      // Original final-token minimums remain unchanged; unused intermediate is refunded.
      const available = total + (combined.amountOut - total) / 2n;
      // Allocate the guaranteed intermediate amount in proportion to leaf costs.
      // Floors go to the first leaves; the last receives the integer remainder.
      let allocated = 0n;
      const budgets = demands.map((quote,i) => {
        const budget = i === demands.length - 1 ? available - allocated : available * quote.amountIn / total;
        allocated += budget; return budget;
      });
      const quotes = await Promise.all(paths.map((path,i) => quoteRegisteredPath([path![1]!], "EXACT_INPUT", budgets[i]!, options.quoteSegment)));
      if (quotes.some((quote,i) => quote.amountOut < legs[i]!.minAmountOut)) return legs;
      const leg = (path: RegisteredPath, amountIn: bigint, minAmountOut: bigint): AdapterSwapLeg => {
        const segment = routeSegments(path)[0]!;
        return { adapter: options.adapter, tokenIn: v4BoundaryToken(path[0]!.tokenIn,options.weth), tokenOut: v4BoundaryToken(path.at(-1)!.tokenOut,options.weth), amountIn, minAmountOut,
          data: universalRouteData(segment.version,segment.data), hops: segment.version === 3 ? routeFrom(segment.tokens,segment.hops.map(hop=>hop.pool.fee)).hops : parseV4Path(segment.data) };
      };
      return [leg([prefix],amount,available), ...paths.map((path,i) => leg([path![1]!],budgets[i]!,legs[i]!.minAmountOut))];
    } catch { return legs; }
  }, quote(type,tokenIn,tokenOut,amount) {
    const key=`${type}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${amount}`;
    const existing=pending.get(key);if(existing)return existing;
    const run=async()=>{
      const boundary=(token:Address)=>v4BoundaryToken(token,options.weth);
      const paths=registeredCandidates(options.pools,options.chainId,tokenIn,tokenOut,options.weth).filter(path=>
        !path.some(hop=>options.forbiddenTokens?.some(token=>sameAddress(token,boundary(hop.tokenIn))||sameAddress(token,boundary(hop.tokenOut))))
        && !routeSegments(path).slice(1).some(segment=>options.reservedTokens?.some(token=>sameAddress(token,boundary(segment.tokens[0]!))))
        );
      let best:PathQuote|undefined;
      try {
        best=await bestRegisteredQuote({paths,type,amount,quoteSegment:options.quoteSegment,authenticate:options.authenticate,
          gasCostInQuoteToken:options.gasCostInQuoteToken ? gas=>options.gasCostInQuoteToken!(type==="EXACT_INPUT"?tokenOut:tokenIn,gas):undefined});
      } catch(error) {
        if(options.fallback)return options.fallback.quote(type,tokenIn,tokenOut,amount);
        throw error;
      }
      const usable=best && best.impactBps<=REGISTERED_ROUTE_POLICY.maxImpactBps && paths.length<=REGISTERED_ROUTE_POLICY.maxCandidates && await options.withinTradeSize(tokenIn,best.amountIn);
      if (!best || !usable) {
        if (options.fallback) return options.fallback.quote(type,tokenIn,tokenOut,amount);
        throw new QuoteFailure(best?"ROUTE_POLICY_EXCEEDED":"NO_ROUTE");
      }
      const amountIn=type==="EXACT_OUTPUT"?applySlippageUp(best.amountIn,options.slippageBps):best.amountIn;
      const legs=best.segments.map((segment,i)=>{
        const last=i===best.segments.length-1;
        const minimum=last?(type==="EXACT_OUTPUT"?best.amountOut:applySlippageDown(best.amountOut,options.slippageBps)):1n;
        return {adapter:options.adapter,tokenIn:boundary(segment.tokens[0]!),tokenOut:boundary(segment.tokens.at(-1)!),
          amountIn:i===0?type==="EXACT_OUTPUT"?amountIn:maxUint256:maxUint256,minAmountOut:minimum,data:universalRouteData(segment.version,segment.data),
          hops:segment.version===3?routeFrom(segment.tokens,segment.hops.map(hop=>hop.pool.fee)).hops:parseV4Path(segment.data)};
      });
      if (type === "EXACT_OUTPUT" && legs.length === 1) selected.set(legs[0]!, best.path);
      return {amountIn,amountOut:best.amountOut,legs,authenticatedPath:best.path};
    };
    const result=run().catch(error=>{pending.delete(key);throw error;});pending.set(key,result);return result;
  }};
}
