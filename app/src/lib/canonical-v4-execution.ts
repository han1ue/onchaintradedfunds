import { encodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem";

export const UNIVERSAL_ROUTER_EXECUTE_ABI = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "commands", type: "bytes" },
    { name: "inputs", type: "bytes[]" },
    { name: "deadline", type: "uint256" },
  ],
  outputs: [],
}] as const;

export const CANONICAL_EXACT_INPUT_PARAM = [{
  type: "tuple",
  components: [
    { name: "currencyIn", type: "address" },
    {
      name: "path",
      type: "tuple[]",
      components: [
        { name: "intermediateCurrency", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
        { name: "hookData", type: "bytes" },
      ],
    },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
  ],
}] as const;

export const ROUTER_MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
export const ROUTER_ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;

export function canonicalV4Execution(input: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  launchManager: Address;
  deadline: bigint;
  nativeInput: boolean;
  nativeOutput: boolean;
}): { data: Hex; value: bigint; commands: Hex; routerInput: Hex } {
  if (input.nativeInput && input.nativeOutput) throw new Error("A canonical OTF swap cannot use native ETH on both sides.");
  const swapParams = encodeAbiParameters(CANONICAL_EXACT_INPUT_PARAM, [{
    currencyIn: input.tokenIn,
    path: [{ intermediateCurrency: input.tokenOut, fee: 0, tickSpacing: 1, hooks: input.launchManager, hookData: "0x" }],
    amountIn: input.amountIn,
    amountOutMinimum: input.amountOutMinimum,
  }]);
  const actions = input.nativeInput || input.nativeOutput ? "0x070b0e" : "0x070c0f";
  const settle = input.nativeInput || input.nativeOutput
    ? encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
        [input.tokenIn, input.amountIn, !input.nativeInput],
      )
    : encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [input.tokenIn, input.amountIn]);
  const take = input.nativeInput || input.nativeOutput
    ? encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [input.tokenOut, input.nativeOutput ? ROUTER_ADDRESS_THIS : ROUTER_MSG_SENDER, 0n],
      )
    : encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [input.tokenOut, input.amountOutMinimum]);
  const routerInput = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settle, take]],
  );
  const commands = input.nativeInput ? "0x0b10" : input.nativeOutput ? "0x100c" : "0x10";
  const inputs = input.nativeInput
    ? [encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ROUTER_ADDRESS_THIS, input.amountIn]), routerInput]
    : input.nativeOutput
      ? [routerInput, encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ROUTER_MSG_SENDER, input.amountOutMinimum])]
      : [routerInput];
  return {
    commands,
    routerInput,
    value: input.nativeInput ? input.amountIn : 0n,
    data: encodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, functionName: "execute", args: [commands, inputs, input.deadline] }),
  };
}
