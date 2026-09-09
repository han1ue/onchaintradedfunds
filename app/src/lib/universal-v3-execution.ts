import { encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Address, type Hex } from "viem";
import { UNIVERSAL_ROUTER_EXECUTE_ABI } from "./canonical-v4-execution";

export function universalV3Execution(path: Hex, recipient: Address, amountIn: bigint, minimumOut: bigint, deadline: bigint): Hex {
  const swap = encodeAbiParameters(parseAbiParameters("address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser,uint256[] minHopPriceX36"), [recipient,amountIn,minimumOut,path,true,[]]);
  return encodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, functionName: "execute", args: ["0x00",[swap],deadline] });
}
