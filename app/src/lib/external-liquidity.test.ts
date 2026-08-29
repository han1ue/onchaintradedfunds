import { describe, expect, it } from "vitest";
import { synthraAddLiquidityUrl, uniswapV3AddPositionUrl } from "./external-liquidity";

const OTF = "0x0000000000000000000000000000000000000001";
const USDG = "0x0000000000000000000000000000000000000002";

describe("external liquidity URLs", () => {
  it("pre-fills Uniswap V3 add position with the selected OTF/USDG pair and intended fee", () => {
    const url = new URL(uniswapV3AddPositionUrl(OTF, USDG));

    expect(url.origin + url.pathname).toBe("https://app.uniswap.org/add/v3");
    expect(url.searchParams.get("chain")).toBe("robinhood");
    expect(url.searchParams.get("currencyA")).toBe(OTF);
    expect(url.searchParams.get("currencyB")).toBe(USDG);
    expect(url.searchParams.get("fee")).toBe("3000");
  });

  it("keeps testnet liquidity on the configured Synthra hash route", () => {
    expect(synthraAddLiquidityUrl("https://app.synthra.org/")).toBe("https://app.synthra.org/#/add/ETH");
    expect(synthraAddLiquidityUrl(undefined)).toBeUndefined();
  });
});
