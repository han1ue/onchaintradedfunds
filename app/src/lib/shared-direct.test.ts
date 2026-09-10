import { describe, expect, it, vi } from "vitest";
import { type Address, zeroAddress } from "viem";
import { quoteRegisteredDirect } from "../server/registered-direct-quote";
import { handleSwapQuoteRequest } from "./uniswap-trading-api";
import { parseTypedQuoteResponse } from "./swap-model";
import { protocolDeploymentForChain } from "./deployment";
import type { AssetRegistry, CatalogAsset, RegisteredPool } from "./asset-catalog";
import type { BasketPlannerRequest } from "./basket-planner";

const state=vi.hoisted(()=>({registry:{assets:[],pools:[]} as AssetRegistry,ready:true,simulate:vi.fn(),read:vi.fn()}));
vi.mock("../server/registry",()=>({readRegistry:async()=>state.registry}));
vi.mock("../server/pricing",()=>({chainClient:()=>({readContract:state.read,simulateCalls:state.simulate})}));
vi.mock("../server/registered-route-client",()=>({registeredRouteClient:()=>({authenticate:async()=>{},withinTradeSize:async()=>true,quoteSegment:async(_segment:unknown,_type:unknown,amount:bigint)=>({amount:amount*2n,gas:1n})})}));
vi.mock("./deployment",async importOriginal=>{
  const actual=await importOriginal<typeof import("./deployment")>();
  return {...actual,protocolDeploymentForChain:(chainId:number)=>({...actual.protocolDeploymentForChain(chainId)!, addresses:{...actual.protocolDeploymentForChain(46630)!.addresses,...Object.fromEntries(Object.entries(actual.protocolDeploymentForChain(chainId)!.addresses).filter(([,value])=>value))},routingReady:state.ready})};
});
const addr=(n:number)=>`0x${n.toString(16).padStart(40,"0")}` as Address;
const now=1_750_000_000_000;

describe.each([4663,46630])("registered direct execution on %s",chainId=>{
  it.each(["v3","v4","mixed","native-in","native-out"])("quotes, simulates and validates %s without an API key",async mode=>{
    state.ready=true;
    const config=protocolDeploymentForChain(chainId)!;
    const weth=config.addresses.weth!;
    const input={address:mode==="native-in"?weth:addr(1),decimals:18,kind:mode==="native-in"?"native" as const:"otf" as const,isFactoryVault:mode!=="native-in"};
    const output={address:mode==="native-out"?weth:addr(2),decimals:18,kind:mode==="native-out"?"native" as const:"otf" as const,isFactoryVault:mode!=="native-out"};
    const asset=(address:Address):CatalogAsset=>({address,chainId,id:address,symbol:"T",name:"Token",decimals:18,assetType:"other",verified:false,enabled:true,featured:false});
    const pool=(id:number,from:Address,to:Address,version:3|4):RegisteredPool=>({id:String(id),chainId,assetA:asset(from),assetB:asset(to),protocolVersion:version,
      venue:"uniswap",fee:3000,tickSpacing:60,hooks:zeroAddress,hookData:"0x",approved:true,enabled:true,validationMetadata:{}});
    const from=mode==="native-in"?zeroAddress:input.address,to=mode==="native-out"?zeroAddress:output.address;
    state.registry={assets:[asset(input.address),asset(output.address)],pools:mode==="mixed"?[pool(1,from,addr(3),3),pool(2,addr(3),to,4)]:[pool(1,from,to,mode==="v3"?3:4)]};
    state.read.mockImplementation(async({functionName}:{functionName:string})=>functionName==="isVault"?true:18);
    state.simulate.mockImplementation(async({calls}:{calls:unknown[]})=>({results:calls.map(()=>({status:"success",gasUsed:1n}))}));
    const request:BasketPlannerRequest={route:"direct",chainId,caller:addr(9),input,output,inputAmountRaw:10_000n,slippageBps:50,requestedAtMs:now-1000};
    const providerRequest=vi.fn();
    const result=await handleSwapQuoteRequest({action:"quote",...request,inputAmountRaw:"10000"},{apiKey:"",now:()=>now,providerRequest,registeredDirect:quoteRegisteredDirect});
    expect(result.status).toBe(200);expect(providerRequest).not.toHaveBeenCalled();
    const context={route:"direct" as const,chainId,now,weth,permit2:config.v4.permit2,universalRouter:config.v4.universalRouter,
      request:{...request,inputAmount:"0.00000000000001",requestedAt:request.requestedAtMs,input:{...input,symbol:"IN",name:"Input",metadataResolved:true},output:{...output,symbol:"OUT",name:"Output",metadataResolved:true}}};
    const quote=parseTypedQuoteResponse(result.body,context);
    expect(quote.execution?.kind).toBe("direct-registered");
    const body=result.body as unknown as {execution:{transaction:{data:string}}};
    expect(()=>parseTypedQuoteResponse({...body,execution:{...body.execution,transaction:{...body.execution.transaction,data:"0x1234"}}},context)).toThrow(/calldata/);
    expect(()=>parseTypedQuoteResponse(result.body,{...context,now:now+46_000})).toThrow(/expired|expiry/i);
    const simulated=state.simulate.mock.lastCall![0];expect(simulated.account).toBe(request.caller);expect(simulated.stateOverrides).toBeUndefined();
  });
  it("keeps an unconfigured deployment unavailable before requesting routes",async()=>{
    state.ready=false;const providerRequest=vi.fn();
    const result=await handleSwapQuoteRequest({action:"quote",route:"direct",chainId,caller:addr(9),input:{address:addr(1),kind:"erc20",decimals:18,isFactoryVault:false},output:{address:addr(2),kind:"otf",decimals:18,isFactoryVault:true},inputAmountRaw:"10000",slippageBps:50,requestedAtMs:now-1000},{apiKey:"test",now:()=>now,providerRequest});
    expect(result.status).toBe(503);expect(providerRequest).not.toHaveBeenCalled();state.ready=true;
  });
  it.each(["decimals", "factory", "metadata-rpc"])("rejects invalid %s before API fallback even when no registered route exists", async failure => {
    state.ready = true;
    state.registry = { assets: [], pools: [] };
    state.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (failure === "metadata-rpc") throw new Error("Metadata unavailable");
      return functionName === "isVault" ? failure !== "factory" : failure === "decimals" ? 6 : 18;
    });
    const providerRequest = vi.fn();
    const result = await handleSwapQuoteRequest({ action: "quote", route: "direct", chainId, caller: addr(9),
      input: { address: addr(1), kind: "erc20", decimals: 18, isFactoryVault: false },
      output: { address: addr(2), kind: "otf", decimals: 18, isFactoryVault: true },
      inputAmountRaw: "10000", slippageBps: 50, requestedAtMs: now - 1000,
    }, { apiKey: "test", now: () => now, providerRequest, registeredDirect: quoteRegisteredDirect });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: "INVALID_ASSET_METADATA" });
    expect(providerRequest).not.toHaveBeenCalled();
  });
});
