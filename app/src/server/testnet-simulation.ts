import "server-only";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits } from "viem";
import { otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { chainClient } from "./pricing";
import { basketSimulationCalls } from "../lib/mainnet-basket-client";
import type { BasketPlannerRequest } from "../lib/basket-planner";
import { parseTypedQuoteResponse } from "../lib/swap-model";
import { robinhoodTestnetAddresses } from "../lib/deployment";
import { testnetVenue } from "../lib/venue-config";
import { QuoteFailure } from "../lib/quote-errors";

export async function simulateTestnetQuote(body:unknown,request:BasketPlannerRequest) {
  const quote=parseTypedQuoteResponse(body,{
    route:request.route,chainId:46630,now:Date.now(),weth:robinhoodTestnetAddresses.weth,
    entryRouter:robinhoodTestnetAddresses.entryRouter,adapter:robinhoodTestnetAddresses.uniswapV3Adapter,v4Adapter:robinhoodTestnetAddresses.uniswapV4Adapter,
    swapRouter02:testnetVenue.swapRouter02,
    request:{...request,requestedAt:request.requestedAtMs,inputAmount:formatUnits(request.inputAmountRaw,request.input.decimals),
      input:{...request.input,name:"Input",symbol:"IN",metadataResolved:true},output:{...request.output,name:"Output",symbol:"OUT",metadataResolved:true}},
  });
  const execution=quote.execution;
  if(!execution || !["direct-v3","basket-router"].includes(execution.kind))throw new QuoteFailure("INVALID_PROVIDER_QUOTE");
  if(execution.kind!=="direct-v3" && execution.kind!=="basket-router")throw new QuoteFailure("INVALID_PROVIDER_QUOTE");
  const calls=execution.kind==="basket-router"?basketSimulationCalls(execution):[
    ...[0n,execution.approval.amount].map(amount=>({to:execution.approval.token,data:encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[execution.approval.spender,amount]})})),
    {...execution.transaction,value:BigInt(execution.transaction.value)},
  ];
  const simulation=await chainClient(46630).simulateCalls({account:request.caller,calls,validation:false});
  if(simulation.results.length!==calls.length || simulation.results.some(result=>result.status!=="success"))throw new QuoteFailure("SIMULATION_FAILED");
  if(execution.kind==="basket-router") {
    const [output]=decodeFunctionResult({abi:otfEntryExitRouterAbi,functionName:execution.call.method,data:simulation.results.at(-1)!.data}) as readonly [bigint,...unknown[]];
    if(output<quote.minimumReceivedRaw!)throw new QuoteFailure("MINIMUM_OUTPUT_NOT_MET");
  }
}
