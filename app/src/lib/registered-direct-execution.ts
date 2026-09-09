import { encodeAbiParameters, encodeFunctionData, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { ROUTER_ADDRESS_THIS, ROUTER_MSG_SENDER, UNIVERSAL_ROUTER_EXECUTE_ABI } from "./canonical-v4-execution";
import { routeSegments, v4QuotePath, type RegisteredPath } from "./registered-routes";
import { sameAddress } from "./basket-planner";

const CONTRACT_BALANCE=1n<<255n;
/** Universal Router 2.1.1: fund once, consume actual intermediate proceeds, and refund remaining currencies. */
export function registeredDirectExecution(input:{path:RegisteredPath;weth:Address;tokenIn:Address;tokenOut:Address;amountIn:bigint;minimumOut:bigint;nativeInput:boolean;nativeOutput:boolean;deadline:bigint}) {
  if(input.amountIn<=0n || input.amountIn>(1n<<160n)-1n || input.minimumOut<=0n || !input.path.length)throw new Error("Invalid registered swap amount.");
  const commands:number[]=[],inputs:Hex[]=[];
  const push=(command:number,data:Hex)=>{commands.push(command);inputs.push(data);};
  const amountParams=parseAbiParameters("address recipient,uint256 amount");
  let current=input.nativeInput?zeroAddress:input.tokenIn;
  if(!input.nativeInput)push(0x02,encodeAbiParameters(parseAbiParameters("address token,address recipient,uint160 amount"),[input.tokenIn,ROUTER_ADDRESS_THIS,input.amountIn]));
  const convert=(currency:Address)=>{
    if(sameAddress(current,currency))return;
    if(current===zeroAddress && sameAddress(currency,input.weth))push(0x0b,encodeAbiParameters(amountParams,[ROUTER_ADDRESS_THIS,CONTRACT_BALANCE]));
    else if(sameAddress(current,input.weth) && currency===zeroAddress)push(0x0c,encodeAbiParameters(amountParams,[ROUTER_ADDRESS_THIS,0n]));
    else throw new Error("Disconnected native currency boundary.");
    current=currency;
  };
  for(const segment of routeSegments(input.path)) {
    convert(segment.tokens[0]!);
    if(segment.version===3) {
      push(0x00,encodeAbiParameters(parseAbiParameters("address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser,uint256[] minHopPriceX36"),[ROUTER_ADDRESS_THIS,CONTRACT_BALANCE,1n,segment.data,false,[]]));
    } else {
      const settle=encodeAbiParameters(parseAbiParameters("address currency,uint256 amount,bool payerIsUser"),[current,CONTRACT_BALANCE,false]);
      const swap=encodeAbiParameters(parseAbiParameters("(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amountIn,uint128 amountOutMinimum)"),[{currencyIn:current,path:v4QuotePath(segment),minHopPriceX36:[],amountIn:0n,amountOutMinimum:1n}]);
      const take=(currency:Address)=>encodeAbiParameters(parseAbiParameters("address currency,address recipient,uint256 amount"),[currency,ROUTER_ADDRESS_THIS,0n]);
      push(0x10,encodeAbiParameters(parseAbiParameters("bytes actions,bytes[] params"),["0x0b070e0e",[settle,swap,take(segment.tokens.at(-1)!),take(current)]]));
    }
    current=segment.tokens.at(-1)!;
  }
  convert(input.nativeOutput?zeroAddress:input.tokenOut);
  const sweep=(token:Address,minimum:bigint)=>push(0x04,encodeAbiParameters(parseAbiParameters("address token,address recipient,uint256 amountMinimum"),[token,ROUTER_MSG_SENDER,minimum]));
  sweep(current,input.minimumOut);
  const refunds=new Set([input.tokenIn,...input.path.flatMap(hop=>[hop.tokenIn,hop.tokenOut]),zeroAddress,input.weth].map(token=>token.toLowerCase()));
  refunds.delete(current.toLowerCase());
  for(const token of refunds)sweep(token as Address,0n);
  return {data:encodeFunctionData({abi:UNIVERSAL_ROUTER_EXECUTE_ABI,functionName:"execute",args:[`0x${commands.map(command=>command.toString(16).padStart(2,"0")).join("")}`,inputs,input.deadline]}),value:input.nativeInput?input.amountIn:0n};
}
