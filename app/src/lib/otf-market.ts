export type OtfSwapSide = "buy" | "sell";

export type OtfSwapQuote = {
  amountOut: bigint;
  minimumReceived: bigint;
  priceImpactBps: number;
  fullyFilled: boolean;
  nextSqrtPriceX96: bigint;
};

const Q96 = 2n ** 96n;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

function amount0Out(liquidity: bigint, sqrtBefore: bigint, sqrtAfter: bigint): bigint {
  return ((liquidity * Q96 * (sqrtAfter - sqrtBefore)) / sqrtAfter) / sqrtBefore;
}

function amount1Out(liquidity: bigint, sqrtBefore: bigint, sqrtAfter: bigint): bigint {
  return liquidity * (sqrtBefore - sqrtAfter) / Q96;
}

export function quoteCanonicalOtfSwap(input: {
  side: OtfSwapSide;
  amountIn: bigint;
  slippageBps: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  lowerSqrtPriceX96: bigint;
  upperSqrtPriceX96: bigint;
  otfIsCurrency0: boolean;
  otfPriceWethWad: bigint;
}): OtfSwapQuote {
  if (input.amountIn <= 0n || input.liquidity <= 0n || input.sqrtPriceX96 <= 0n) {
    throw new Error("A positive amount and active pool liquidity are required.");
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 3_000) {
    throw new Error("Slippage must be between 0.01% and 30%.");
  }
  const zeroForOne = input.side === "buy" ? !input.otfIsCurrency0 : input.otfIsCurrency0;
  let nextSqrtPriceX96: bigint;
  let amountOut: bigint;
  let fullyFilled = true;
  if (zeroForOne) {
    const numerator = input.liquidity * Q96 * input.sqrtPriceX96;
    const denominator = input.liquidity * Q96 + input.amountIn * input.sqrtPriceX96;
    nextSqrtPriceX96 = ceilDiv(numerator, denominator);
    if (nextSqrtPriceX96 < input.lowerSqrtPriceX96) {
      nextSqrtPriceX96 = input.lowerSqrtPriceX96;
      fullyFilled = false;
    }
    amountOut = amount1Out(input.liquidity, input.sqrtPriceX96, nextSqrtPriceX96);
  } else {
    nextSqrtPriceX96 = input.sqrtPriceX96 + input.amountIn * Q96 / input.liquidity;
    if (nextSqrtPriceX96 > input.upperSqrtPriceX96) {
      nextSqrtPriceX96 = input.upperSqrtPriceX96;
      fullyFilled = false;
    }
    amountOut = amount0Out(input.liquidity, input.sqrtPriceX96, nextSqrtPriceX96);
  }
  const spotAmountOut = input.side === "buy"
    ? input.amountIn * 10n ** 18n / input.otfPriceWethWad
    : input.amountIn * input.otfPriceWethWad / 10n ** 18n;
  const impact = spotAmountOut > amountOut && spotAmountOut > 0n
    ? Number((spotAmountOut - amountOut) * 10_000n / spotAmountOut)
    : 0;
  return {
    amountOut,
    minimumReceived: amountOut * BigInt(10_000 - input.slippageBps) / 10_000n,
    priceImpactBps: impact,
    fullyFilled,
    nextSqrtPriceX96,
  };
}

export function burnedSupply(maxSupply: bigint, totalSupply: bigint) {
  if (totalSupply > maxSupply) throw new Error("Current supply exceeds original supply.");
  const burned = maxSupply - totalSupply;
  return { burned, burnedBps: maxSupply === 0n ? 0 : Number(burned * 10_000n / maxSupply) };
}

export function feeBenefitRows() {
  return [
    { otf: "0", creator: "50%", buyback: "50%" },
    { otf: "1m", creator: "62.64%", buyback: "37.36%" },
    { otf: "2.5m", creator: "70%", buyback: "30%" },
    { otf: "5m", creator: "78.28%", buyback: "21.72%" },
    { otf: "10m+", creator: "90%", buyback: "10%" },
  ] as const;
}
