import { formatUnits, zeroAddress } from "viem";
import { basketQuote, sameAddress, type BasketPlannerRequest } from "./basket-planner";
import { robinhoodMainnetBasketDeployment } from "./deployment";
import { mainnetBasketClient, type MainnetBasketClient, type MainnetBasketDeployment } from "./mainnet-basket-client";
import { parseTypedQuoteResponse } from "./swap-model";
import { uniswapBasketRoutes } from "./uniswap-basket-routes";

export async function quoteMainnetBasket(request: BasketPlannerRequest, dependencies: {
  now?: () => number;
  requestQuote(body: Record<string, unknown>): Promise<unknown>;
  client?: MainnetBasketClient;
  deployment?: MainnetBasketDeployment;
}) {
  const unavailable = (reason: string) => ({ status: 503, body: { state: "unavailable", route: "basket", reason } });
  const deployment = dependencies.deployment ?? robinhoodMainnetBasketDeployment;
  if (request.chainId !== 4663 || request.route !== "basket") return unavailable("Basket routing is unsupported on this network.");
  if (!deployment) return unavailable("The mainnet basket deployment is not configured.");
  const clock = dependencies.now ?? Date.now;
  const now = clock();
  const client = dependencies.client ?? mainnetBasketClient(deployment);
  try {
    await client.verifyBindings();
    for (const asset of [request.input, request.output]) {
      if (asset.kind === "otf" && (!asset.isFactoryVault || !await client.isVault(asset.address))) throw new Error("Unrecognized OTF.");
      if (asset.kind === "native" && !sameAddress(asset.address, deployment.weth)) throw new Error("Noncanonical native token.");
      if (await client.decimals(asset.address) !== asset.decimals) throw new Error("Wrong token decimals.");
    }
    const vaultAssets = new Map(await Promise.all([request.input, request.output].filter((asset) => asset.kind === "otf").map(async (asset) => [asset.address.toLowerCase(), await client.vaultAssets(asset.address)] as const)));
    const basketClient = { ...client, vaultAssets: async (vault: typeof request.input.address) => {
      const assets = vaultAssets.get(vault.toLowerCase());
      if (!assets) throw new Error("Unknown basket vault.");
      return assets;
    } };
    const routes = uniswapBasketRoutes({
      chainId: request.chainId, router: deployment.entryRouter, adapter: deployment.uniswapV3Adapter,
      v4Adapter: deployment.uniswapV4Adapter,
      reservedTokens: [...vaultAssets.values()].flat(),
      slippageBps: request.slippageBps,
      forbiddenTokens: [request.input, request.output].filter((asset) => asset.kind === "otf").map((asset) => asset.address),
      requestQuote: dependencies.requestQuote, authenticatePool: client.authenticatePool, authenticateV4Pool: client.authenticateV4Pool,
    });
    const result = await basketQuote(request, basketClient, now, deployment.entryRouter, deployment.uniswapV3Adapter, routes, { address: deployment.weth, decimals: 18 });
    result.body.execution.v4Adapter = deployment.uniswapV4Adapter;
    const quote = parseTypedQuoteResponse(result.body, {
      route: "basket", chainId: request.chainId, now,
      entryRouter: deployment.entryRouter, adapter: deployment.uniswapV3Adapter,
      v4Adapter: deployment.uniswapV4Adapter,
      request: {
        ...request, requestedAt: request.requestedAtMs, inputAmount: formatUnits(request.inputAmountRaw, request.input.decimals),
        input: { ...request.input, name: "Input", symbol: "IN", metadataResolved: true },
        output: { ...request.output, name: "Output", symbol: "OUT", metadataResolved: true },
      },
    });
    if (quote.execution?.kind !== "basket-router") throw new Error("Invalid basket execution.");
    const simulation = await client.simulate(quote.execution);
    if (clock() >= result.body.expiresAtMs || simulation.amountOut < BigInt(result.body.minimumReceivedRaw)) throw new Error("Basket quote expired or simulation output is insufficient.");
    // Keep favourable simulation movement conservative so the original minimum still
    // respects the requested tolerance relative to the displayed expected output.
    const expected = simulation.amountOut < BigInt(result.body.expectedOutputRaw) ? simulation.amountOut : BigInt(result.body.expectedOutputRaw);
    const output = formatUnits(expected, request.output.decimals);
    result.body.expectedOutputRaw = expected.toString();
    result.body.expectedOutput = output;
    result.body.outputAmount = output;
    const residualRefunds = await Promise.all(simulation.refunds.filter((refund) => refund.amount > 0n).map(async (refund) => ({
      token: refund.token, amount: refund.amount.toString(),
      displayAmount: formatUnits(refund.amount, sameAddress(refund.token, zeroAddress) ? 18 : await client.decimals(refund.token)),
    })));
    if (clock() >= result.body.expiresAtMs) throw new Error("Basket quote expired.");
    return { status: 200, body: {
      ...result.body, gasEstimate: simulation.gasUsed.toString(),
      residualRefunds,
    } };
  } catch {
    return unavailable("No executable mainnet basket route is currently available.");
  }
}
