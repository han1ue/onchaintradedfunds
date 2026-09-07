import { concatHex, numberToHex, type Address, type Hex } from "viem";
import { sameAddress } from "./basket-planner";

export type Route = {
  tokens: readonly Address[];
  fees: readonly number[];
  path: Hex;
  hops: readonly { venue: "Uniswap V3"; tokenIn: Address; tokenOut: Address; feeTier: number }[];
};

export function encodeV3Path(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length !== fees.length + 1 || fees.length === 0 || fees.length > 3) throw new Error("Uniswap V3 path has an invalid shape.");
  const parts: Hex[] = [tokens[0] as Hex];
  for (let index = 0; index < fees.length; index += 1) {
    const fee = fees[index]!;
    if (!Number.isInteger(fee) || fee <= 0 || fee > 1_000_000 || sameAddress(tokens[index]!, tokens[index + 1]!)) throw new Error("Uniswap V3 path has an invalid hop.");
    parts.push(numberToHex(fee, { size: 3 }), tokens[index + 1] as Hex);
  }
  return concatHex(parts);
}

export function reverseRoute(route: Route): Route {
  const tokens = [...route.tokens].reverse();
  const fees = [...route.fees].reverse();
  return routeFrom(tokens, fees);
}

export function routeFrom(tokens: readonly Address[], fees: readonly number[]): Route {
  return {
    tokens,
    fees,
    path: encodeV3Path(tokens, fees),
    hops: fees.map((feeTier, index) => ({
      venue: "Uniswap V3" as const,
      tokenIn: tokens[index]!,
      tokenOut: tokens[index + 1]!,
      feeTier,
    })),
  };
}

