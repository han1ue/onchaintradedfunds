import { formatUnits, zeroAddress } from "viem";
import { basketQuote, sameAddress, type BasketPlannerRequest } from "./basket-planner";
import { robinhoodMainnetBasketDeployment } from "./deployment";
import { mainnetBasketClient, type MainnetBasketClient, type MainnetBasketDeployment } from "./mainnet-basket-client";
import { parseTypedQuoteResponse } from "./swap-model";
import { uniswapBasketRoutes } from "./uniswap-basket-routes";
import { QuoteFailure, quoteStep } from "./quote-errors";
import { unavailableQuoteResponse } from "./quote-diagnostics";

export async function quoteMainnetBasket(request: BasketPlannerRequest, dependencies: {
  now?: () => number;
  requestQuote(body: Record<string, unknown>): Promise<unknown>;
  client?: MainnetBasketClient;
  deployment?: MainnetBasketDeployment;
}) {
  const deployment = dependencies.deployment ?? robinhoodMainnetBasketDeployment;
  if (request.chainId !== 4663 || request.route !== "basket" || !deployment) return unavailableQuoteResponse(request, "configuration", new QuoteFailure("ROUTE_NOT_CONFIGURED"));
  const clock = dependencies.now ?? Date.now;
  const now = clock();
  const client = dependencies.client ?? mainnetBasketClient(deployment);
  let stage = "bindings";
  try {
    await quoteStep("DEPLOYMENT_MISMATCH", () => client.verifyBindings());
    stage = "metadata";
    for (const asset of [request.input, request.output]) {
      if (asset.kind === "otf" && (!asset.isFactoryVault || !await client.isVault(asset.address))) throw new QuoteFailure("INVALID_ASSET_METADATA");
      if (asset.kind === "native" && !sameAddress(asset.address, deployment.weth)) throw new QuoteFailure("INVALID_ASSET_METADATA");
      if (await client.decimals(asset.address) !== asset.decimals) throw new QuoteFailure("INVALID_ASSET_METADATA");
    }
    const vaultAssets = new Map(await Promise.all([request.input, request.output].filter((asset) => asset.kind === "otf").map(async (asset) => [asset.address.toLowerCase(), await client.vaultAssets(asset.address)] as const)));
    const basketClient = { ...client, vaultAssets: async (vault: typeof request.input.address) => {
      const assets = vaultAssets.get(vault.toLowerCase());
      if (!assets) throw new Error("Unknown basket vault.");
      return assets;
    } };
    stage = "routing";
    const routes = uniswapBasketRoutes({
      chainId: request.chainId, router: deployment.entryRouter, adapter: deployment.uniswapV3Adapter,
      v4Adapter: deployment.uniswapV4Adapter,
      weth: deployment.weth,
      reservedTokens: [...vaultAssets.values()].flat(),
      slippageBps: request.slippageBps,
      forbiddenTokens: [request.input, request.output].filter((asset) => asset.kind === "otf").map((asset) => asset.address),
      requestQuote: dependencies.requestQuote, authenticatePool: client.authenticatePool, authenticateV4Pool: client.authenticateV4Pool,
    });
    const result = await basketQuote(request, basketClient, now, deployment.entryRouter, deployment.uniswapV3Adapter, routes, { address: deployment.weth, decimals: 18 });
    result.body.execution.v4Adapter = deployment.uniswapV4Adapter;
    stage = "plan-validation";
    const quote = parseTypedQuoteResponse(result.body, {
      route: "basket", chainId: request.chainId, now,
      entryRouter: deployment.entryRouter, adapter: deployment.uniswapV3Adapter,
      v4Adapter: deployment.uniswapV4Adapter,
      weth: deployment.weth,
      request: {
        ...request, requestedAt: request.requestedAtMs, inputAmount: formatUnits(request.inputAmountRaw, request.input.decimals),
        input: { ...request.input, name: "Input", symbol: "IN", metadataResolved: true },
        output: { ...request.output, name: "Output", symbol: "OUT", metadataResolved: true },
      },
    });
    if (quote.execution?.kind !== "basket-router") throw new Error("Invalid basket execution.");
    const execution = quote.execution;
    stage = "simulation";
    const simulation = await quoteStep("SIMULATION_FAILED", () => client.simulate(execution));
    if (clock() >= result.body.expiresAtMs) throw new QuoteFailure("QUOTE_EXPIRED");
    if (simulation.amountOut < BigInt(result.body.minimumReceivedRaw)) throw new QuoteFailure("MINIMUM_OUTPUT_NOT_MET");
    // Keep favourable simulation movement conservative so the original minimum still
    // respects the requested tolerance relative to the displayed expected output.
    const expected = simulation.amountOut < BigInt(result.body.expectedOutputRaw) ? simulation.amountOut : BigInt(result.body.expectedOutputRaw);
    const output = formatUnits(expected, request.output.decimals);
    result.body.expectedOutputRaw = expected.toString();
    result.body.expectedOutput = output;
    result.body.outputAmount = output;
    stage = "refunds";
    const residualRefunds = await Promise.all(simulation.refunds.filter((refund) => refund.amount > 0n).map(async (refund) => ({
      token: refund.token, amount: refund.amount.toString(),
      displayAmount: formatUnits(refund.amount, sameAddress(refund.token, zeroAddress) ? 18 : await client.decimals(refund.token)),
    })));
    if (clock() >= result.body.expiresAtMs) throw new QuoteFailure("QUOTE_EXPIRED");
    return { status: 200, body: {
      ...result.body, gasEstimate: simulation.gasUsed.toString(),
      residualRefunds,
    } };
  } catch (error) {
    return unavailableQuoteResponse(request, stage, error);
  }
}
