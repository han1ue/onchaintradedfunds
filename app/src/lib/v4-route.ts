import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { type SwapRouteHop } from "./swap-model";

export type V4PathKey = { intermediateCurrency: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex };
const pathAbi = parseAbiParameters("address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path");
const poolAbi = parseAbiParameters("address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks");

export function v4PoolId(tokenIn: Address, hop: V4PathKey): Hex {
  const [currency0, currency1] = BigInt(tokenIn) < BigInt(hop.intermediateCurrency) ? [tokenIn, hop.intermediateCurrency] : [hop.intermediateCurrency, tokenIn];
  return keccak256(encodeAbiParameters(poolAbi, [currency0, currency1, hop.fee, hop.tickSpacing, hop.hooks]));
}

export function encodeV4Path(currencyIn: Address, path: readonly V4PathKey[]): Hex {
  return encodeAbiParameters(pathAbi, [currencyIn, path]);
}

export function parseV4Path(data: Hex): readonly SwapRouteHop[] {
  if (data.length > 2 + 4096 * 2) throw new Error("V4 path is too large.");
  const [currencyIn, path] = decodeAbiParameters(pathAbi, data);
  let tokenIn = currencyIn;
  if (!path.length || path.length > 3 || encodeV4Path(currencyIn, path).toLowerCase() !== data.toLowerCase()) throw new Error("Invalid V4 path encoding.");
  return path.map((hop) => {
    const tokenOut = hop.intermediateCurrency;
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()
      || (hop.fee > 1_000_000 && hop.fee !== 0x800000)
      || hop.tickSpacing <= 0 || hop.tickSpacing > 32767 || (hop.hookData.length - 2) / 2 > 1024) throw new Error("Unsupported V4 hop.");
    const result: SwapRouteHop = { venue: "Uniswap V4", tokenIn, tokenOut, feeTier: hop.fee };
    tokenIn = tokenOut;
    return result;
  });
}

export function v4BoundaryToken(currency: Address, weth: Address): Address {
  return currency.toLowerCase() === zeroAddress ? weth : currency;
}
