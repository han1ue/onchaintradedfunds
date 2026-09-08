import {describe,expect,it} from "vitest";
import {stockPriceUsdFromYahoo,marketCapObservationFromYahoo} from "./yahoo-market-data";
describe("source observations",()=>{
  it("requires the stock price's actual market timestamp",()=>{
    const meta={regularMarketPrice:376.37,regularMarketTime:1788220800};
    expect(stockPriceUsdFromYahoo({chart:{result:[{meta}]}})).toEqual({priceUsd:"376.37",priceUpdatedAt:"2026-09-01T00:00:00.000Z"});
    expect(stockPriceUsdFromYahoo({chart:{result:[{meta:{regularMarketPrice:376.37}}]}})).toBeUndefined();
  });
  it("pairs market cap with the timestamp of the selected observation",()=>{
    expect(marketCapObservationFromYahoo({timeseries:{result:[
      {trailingMarketCap:[{asOfDate:"2026-06-30",reportedValue:{raw:"125.123"}},{asOfDate:"2026-03-31",reportedValue:{raw:100}}]},
      {quarterlyMarketCap:[{asOfDate:"2026-09-01",reportedValue:{raw:900}}]},
    ]}})).toEqual({marketCapUsd:"125.123",sourceAt:"2026-06-30T00:00:00.000Z"});
    expect(marketCapObservationFromYahoo({timeseries:{result:[{trailingMarketCap:[{reportedValue:{raw:125}}]}]}})).toBeUndefined();
  });
});
