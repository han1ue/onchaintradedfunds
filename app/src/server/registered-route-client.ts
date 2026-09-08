import "server-only";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, zeroAddress, type Address } from "viem";
import mainnet from "../config/robinhood-mainnet.json";
import testnet from "../config/robinhood-testnet.json";
import { chainClient, readPrices } from "./pricing";
import { protocolDeploymentForChain } from "../lib/deployment";
import { parseFixedDecimal } from "../lib/creation-model";
import { v4PoolId } from "../lib/v4-route";
import { REGISTERED_ROUTE_POLICY, v4QuotePath, type RouteSegment } from "../lib/registered-routes";
import type { RegisteredPool } from "../lib/asset-catalog";
import { routeFrom } from "../lib/v3-route";
import { QuoteFailure } from "../lib/quote-errors";

export const registeredV3QuoterAbi = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256,uint160[],uint32[],uint256)",
  "function quoteExactOutput(bytes path,uint256 amountOut) returns (uint256,uint160[],uint32[],uint256)",
]);
export const registeredV4QuoterAbi = parseAbi([
  "function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns (uint256,uint256)",
  "function quoteExactOutput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns (uint256,uint256)",
]);
const bindings=parseAbi(["function factory() view returns(address)","function poolManager() view returns(address)","function getPool(address,address,uint24) view returns(address)","function token0() view returns(address)","function token1() view returns(address)","function fee() view returns(uint24)","function liquidity() view returns(uint128)","function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)"]);

export function registeredRouteClient(chainId:number) {
  const client=chainClient(chainId);
  const external=(chainId===46630?testnet:mainnet).externalContracts as Record<string,string>;
  const address=(key:string)=>{const value=external[key];if(!value)throw new QuoteFailure("ROUTE_NOT_CONFIGURED");return getAddress(value);};
  let block:Promise<bigint>|undefined;
  const getBlock=()=>block??=client.getBlockNumber();
  let prices:ReturnType<typeof readPrices>|undefined;
  const authenticated=new Map<string,Promise<void>>();
  const verify=async(pool:RegisteredPool)=>{
    if(pool.chainId!==chainId || !pool.approved || !pool.enabled || pool.venue!=="uniswap" || await client.getChainId()!==chainId) throw new QuoteFailure("POOL_VALIDATION_FAILED");
    const blockNumber=await getBlock();
    for(const asset of [pool.assetA,pool.assetB]) {
      if(asset.address===zeroAddress) {if(pool.protocolVersion!==4 || asset.decimals!==18)throw new QuoteFailure("INVALID_ASSET_METADATA");continue;}
      if(await client.readContract({address:asset.address,abi:erc20Abi,functionName:"decimals",blockNumber})!==asset.decimals) throw new QuoteFailure("INVALID_ASSET_METADATA");
    }
    if(pool.protocolVersion===3) {
      if(!pool.address)throw new QuoteFailure("POOL_VALIDATION_FAILED");
      const factory=address("uniswapV3Factory");
      const [actual,owner,token0,token1,fee,liquidity,quoterFactory]=await Promise.all([
        client.readContract({address:factory,abi:bindings,functionName:"getPool",args:[pool.assetA.address,pool.assetB.address,pool.fee],blockNumber}),
        client.readContract({address:pool.address,abi:bindings,functionName:"factory",blockNumber}),
        client.readContract({address:pool.address,abi:bindings,functionName:"token0",blockNumber}),
        client.readContract({address:pool.address,abi:bindings,functionName:"token1",blockNumber}),
        client.readContract({address:pool.address,abi:bindings,functionName:"fee",blockNumber}),
        client.readContract({address:pool.address,abi:bindings,functionName:"liquidity",blockNumber}),
        client.readContract({address:address(chainId===46630?"uniswapV3QuoterV2":"uniswapV3Quoter"),abi:bindings,functionName:"factory",blockNumber}),
      ]);
      const tokens=[pool.assetA.address.toLowerCase(),pool.assetB.address.toLowerCase()].sort();
      if(actual.toLowerCase()!==pool.address.toLowerCase() || owner!==factory || quoterFactory!==factory || token0.toLowerCase()!==tokens[0] || token1.toLowerCase()!==tokens[1] || fee!==pool.fee)throw new QuoteFailure("POOL_VALIDATION_FAILED");
      if(!liquidity)throw new QuoteFailure("NO_LIQUIDITY");
      if(pool.runtimeCodehash) {const code=await client.getCode({address:pool.address,blockNumber});if(!code||keccak256(code)!==pool.runtimeCodehash)throw new QuoteFailure("POOL_VALIDATION_FAILED");}
    } else {
      const manager=address("uniswapV4PoolManager"),stateView=address("uniswapV4StateView"),quoter=address("uniswapV4Quoter");
      if(pool.poolManager?.toLowerCase()!==manager.toLowerCase() || !pool.hooks || pool.tickSpacing===undefined || pool.poolId!==v4PoolId(pool.assetA.address,{intermediateCurrency:pool.assetB.address,fee:pool.fee,tickSpacing:pool.tickSpacing,hooks:pool.hooks,hookData:pool.hookData}))throw new QuoteFailure("POOL_VALIDATION_FAILED");
      const [viewManager,quoterManager,state]=await Promise.all([
        client.readContract({address:stateView,abi:bindings,functionName:"poolManager",blockNumber}),
        client.readContract({address:quoter,abi:bindings,functionName:"poolManager",blockNumber}),
        client.readContract({address:stateView,abi:bindings,functionName:"getSlot0",args:[pool.poolId],blockNumber}),
      ]);
      if(viewManager!==manager || quoterManager!==manager || !state[0])throw new QuoteFailure("POOL_VALIDATION_FAILED");
      if(pool.hooks!==zeroAddress) {const code=await client.getCode({address:pool.hooks,blockNumber});if(!code||keccak256(code)!==pool.validationMetadata.hookRuntimeCodehash)throw new QuoteFailure("POOL_VALIDATION_FAILED");}
    }
  };
  return {
    authenticate(pool:RegisteredPool) {if(!authenticated.has(pool.id))authenticated.set(pool.id,verify(pool));return authenticated.get(pool.id)!;},
    async quoteSegment(segment:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint) {
      const functionName=type==="EXACT_INPUT"?"quoteExactInput":"quoteExactOutput";
      if(segment.version===3) {
        const path=type==="EXACT_OUTPUT"?routeFrom([...segment.tokens].reverse(),segment.hops.map(hop=>hop.pool.fee).reverse()).path:segment.data;
        const response=await client.call({to:address(chainId===46630?"uniswapV3QuoterV2":"uniswapV3Quoter"),blockNumber:await getBlock(),data:encodeFunctionData({abi:registeredV3QuoterAbi,functionName,args:[path,amount]})});
        if(!response.data)throw new QuoteFailure("NO_ROUTE");
        const result=decodeFunctionResult({abi:registeredV3QuoterAbi,functionName,data:response.data});
        return {amount:result[0],gas:result[3]};
      }
      if(amount>(1n<<127n)-1n)throw new QuoteFailure("ROUTE_POLICY_EXCEEDED");
      const params={exactCurrency:type==="EXACT_OUTPUT"?segment.tokens.at(-1)!:segment.tokens[0]!,path:v4QuotePath(segment,type==="EXACT_OUTPUT"),exactAmount:amount};
      const response=await client.call({to:address("uniswapV4Quoter"),blockNumber:await getBlock(),data:encodeFunctionData({abi:registeredV4QuoterAbi,functionName,args:[params]})});
      if(!response.data)throw new QuoteFailure("NO_ROUTE");
      const result=decodeFunctionResult({abi:registeredV4QuoterAbi,functionName,data:response.data});
      return {amount:result[0],gas:result[1]};
    },
    async withinTradeSize(token:Address,amount:bigint) {
      const deployment=protocolDeploymentForChain(chainId)?.addresses;
      // Quantity caps for quote currencies do not assert that USDG equals one dollar.
      if (token.toLowerCase()===deployment?.usdg?.toLowerCase()) return amount<=10_000n*10n**6n;
      if (token.toLowerCase()===deployment?.weth?.toLowerCase()) return amount<=10n**18n;
      const observation=(await (prices??=readPrices(chainId))).find(price=>price.address.toLowerCase()===token.toLowerCase()&&price.usable);
      if(!observation)return false;
      const value=amount*parseFixedDecimal(observation.priceUsd,36)!/10n**BigInt(observation.decimals);
      return value<=BigInt(REGISTERED_ROUTE_POLICY.maxTradeUsd)*10n**36n;
    },
  };
}
