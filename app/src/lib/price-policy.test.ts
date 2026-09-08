import {describe,expect,it} from "vitest";
import {priceQuality,navValues,valueHoldings} from "./price-policy";
import {chartHistory} from "./fund-history";
import {databaseSchema,assertDatabaseWrites} from "../server/database";
describe("price freshness and exact NAV",()=>{
  const now=Date.parse("2026-09-08T12:00:00Z");
  it("never freshens old observations by collecting again",()=>{
    expect(priceQuality("2026-09-08T10:00:00Z",new Date(now).toISOString(),300,false,now)).toBe("stale");
    expect(priceQuality("2026-09-08T11:59:00Z",new Date(now).toISOString(),300,true,now)).toBe("market_closed");
    expect(priceQuality("2026-09-08T13:00:00Z",new Date(now).toISOString(),300,false,now)).toBe("invalid");
    expect(priceQuality("2026-09-04T20:00:00Z",new Date(now).toISOString(),90000,true,now,345600)).toBe("market_closed");
    expect(priceQuality("2026-09-04T20:00:00Z",new Date(now).toISOString(),90000,false,now,345600)).toBe("stale");
  });
  it("keeps holdings, NAV/share and bootstrap values distinct with exact decimals",()=>{
    const holdings=[{amount:3_000_001n,bootstrapAmount:1_000_000n,decimals:6,priceUsd:"2.000000000000000001"},{amount:6n*10n**18n,bootstrapAmount:2n*10n**18n,decimals:18,priceUsd:"3"}];
    const values=navValues(holdings,2n*10n**18n);
    expect(values).toEqual({totalNavUsd:"24.000002000000000003000001",navPerShareUsd:"12.0000010000000000015000005",bootstrapNavUsd:null});
    expect(navValues(holdings.map(h=>({...h,amount:0n})),0n)).toEqual({totalNavUsd:"0",navPerShareUsd:null,bootstrapNavUsd:"8.000000000000000001"});
    expect(()=>valueHoldings([{amount:-1n,decimals:18,priceUsd:"1"}])).toThrow();
    expect(chartHistory([])).toEqual([]);
  });
  it("isolates preview branches and blocks production writes by default",()=>{
    expect(databaseSchema({})).toBe("otf_development");
    expect(databaseSchema({VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"feature/a"})).not.toBe(databaseSchema({VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"feature/b"}));
    expect(()=>databaseSchema({REGISTRY_TEST_SCHEMA:"otf_production"})).toThrow();
    expect(()=>databaseSchema({VERCEL_ENV:"preview"})).toThrow();
    expect(()=>assertDatabaseWrites({VERCEL_ENV:"production"})).toThrow();
  });
});
