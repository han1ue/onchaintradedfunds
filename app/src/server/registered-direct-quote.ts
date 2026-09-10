import "server-only";
import { encodeFunctionData, erc20Abi, parseAbi, type Address } from "viem";
import { otfFactoryAbi } from "@onchaintradedfunds/generated";
import { readRegistry } from "./registry";
import { registeredRouteClient } from "./registered-route-client";
import { chainClient } from "./pricing";
import { protocolDeploymentForChain } from "../lib/deployment";
import { registeredCandidates,bestRegisteredQuote,REGISTERED_ROUTE_POLICY } from "../lib/registered-routes";
import { registeredDirectExecution } from "../lib/registered-direct-execution";
import { applySlippageDown, type BasketPlannerRequest } from "../lib/basket-planner";
import { QuoteFailure, quoteStep } from "../lib/quote-errors";
import { routeFrom } from "../lib/v3-route";
import { parseV4Path } from "../lib/v4-route";

export async function quoteRegisteredDirect(request:BasketPlannerRequest,expiresAt:number) {
  const deployment=protocolDeploymentForChain(request.chainId)?.addresses;
  const {universalRouter,permit2}=protocolDeploymentForChain(request.chainId)?.v4 ?? {};
  if(!protocolDeploymentForChain(request.chainId)?.routingReady || !deployment?.weth||!universalRouter||!permit2)return undefined;
  const weth = deployment.weth;
  const client=chainClient(request.chainId);
  const registry = await quoteStep("INVALID_ASSET_METADATA", async () => {
    for(const asset of [request.input,request.output]) {
      if(asset.kind==="native" && (asset.decimals!==18 || asset.address.toLowerCase()!==weth.toLowerCase()))throw new QuoteFailure("INVALID_ASSET_METADATA");
      if(asset.kind==="otf" && (!deployment.factory||!asset.isFactoryVault||!await client.readContract({address:deployment.factory,abi:otfFactoryAbi,functionName:"isVault",args:[asset.address]})))throw new QuoteFailure("INVALID_ASSET_METADATA");
      if(asset.kind!=="native" && await client.readContract({address:asset.address,abi:erc20Abi,functionName:"decimals"})!==asset.decimals)throw new QuoteFailure("INVALID_ASSET_METADATA");
    }
    return readRegistry(request.chainId);
  });
  if ([request.input, request.output].some(asset => registry.assets.some(registered => registered.chainId === request.chainId
    && registered.address.toLowerCase() === asset.address.toLowerCase() && !registered.enabled))) throw new QuoteFailure("INVALID_ASSET_METADATA");
  const paths=registeredCandidates(registry.pools,request.chainId,request.input.address,request.output.address,deployment.weth);
  if(!paths.length||paths.length>REGISTERED_ROUTE_POLICY.maxCandidates)return undefined;
  const routing=registeredRouteClient(request.chainId);
  const best=await bestRegisteredQuote({paths,type:"EXACT_INPUT",amount:request.inputAmountRaw,...routing});
  if(!best || best.impactBps>REGISTERED_ROUTE_POLICY.maxImpactBps || !await routing.withinTradeSize(request.input.address,best.amountIn))return undefined;
  const minimum=applySlippageDown(best.amountOut,request.slippageBps);
  const tx=registeredDirectExecution({path:best.path,weth:deployment.weth,tokenIn:request.input.address,tokenOut:request.output.address,amountIn:request.inputAmountRaw,minimumOut:minimum,nativeInput:request.input.kind==="native",nativeOutput:request.output.kind==="native",deadline:BigInt(Math.floor(expiresAt/1000))});
  const calls:{to:Address;data:typeof tx.data;value?:bigint}[]=[];
  if(request.input.kind!=="native") {
    for(const amount of [0n,request.inputAmountRaw])calls.push({to:request.input.address,data:encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[permit2,amount]})});
    calls.push({to:permit2,data:encodeFunctionData({abi:parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]),functionName:"approve",args:[request.input.address,universalRouter,request.inputAmountRaw,Math.floor(expiresAt/1000)]})});
  }
  calls.push({to:universalRouter,...tx});
  const simulation=await client.simulateCalls({account:request.caller,calls,validation:false});
  if(simulation.results.length!==calls.length||simulation.results.some(result=>result.status!=="success"))throw new QuoteFailure("SIMULATION_FAILED");
  return {expectedAmountOut:best.amountOut,minAmountOut:minimum,expiresAtMs:expiresAt,
    segments: best.segments.map(({version,data}) => ({version,data})),
    hops: best.segments.flatMap(segment => segment.version === 3 ? routeFrom(segment.tokens, segment.hops.map(hop => hop.pool.fee)).hops : parseV4Path(segment.data)),
    transaction:{chainId:request.chainId,from:request.caller,to:universalRouter,data:tx.data,value:tx.value.toString()},
    gasEstimate:simulation.results.reduce((gas,result)=>gas+result.gasUsed,0n).toString(),impactBps:best.impactBps};
}
