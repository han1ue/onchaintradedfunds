type RecordValue = Record<string, unknown>;
function record(value:unknown):RecordValue|undefined {
  return value && typeof value==="object" && !Array.isArray(value)?value as RecordValue:undefined;
}
function positiveDecimal(value:unknown) {
  if(typeof value==="number" && Number.isFinite(value) && value>0)return value.toString();
  if(typeof value==="string" && /^\d+(?:\.\d+)?$/.test(value) && Number(value)>0)return value;
}
export function stockPriceUsdFromYahoo(payload:unknown) {
  const results=record(record(payload)?.chart)?.result;
  const meta=Array.isArray(results)?record(record(results[0])?.meta):undefined;
  const priceUsd=positiveDecimal(meta?.regularMarketPrice),timestamp=meta?.regularMarketTime;
  if(!priceUsd || !Number.isSafeInteger(timestamp) || Number(timestamp)<=0)return undefined;
  return {priceUsd,priceUpdatedAt:new Date(Number(timestamp)*1000).toISOString()};
}
export function marketCapObservationFromYahoo(payload:unknown) {
  const results=record(record(payload)?.timeseries)?.result;
  if(!Array.isArray(results))return undefined;
  for(const type of ["trailingMarketCap","quarterlyMarketCap"]) {
    const observations=results.flatMap(value=>{
      const series=record(value),rows=series?.[type],timestamps=series?.timestamp;
      if(!Array.isArray(rows))return [];
      return rows.flatMap((value,index)=>{
        const row=record(value),marketCapUsd=positiveDecimal(record(row?.reportedValue)?.raw);
        const timestamp=typeof row?.asOfDate==="string"?Date.parse(row.asOfDate):Array.isArray(timestamps)?Number(timestamps[index])*1000:NaN;
        return marketCapUsd && Number.isFinite(timestamp) && timestamp>0?[{marketCapUsd,sourceAt:new Date(timestamp).toISOString()}]:[];
      });
    }).sort((a,b)=>Date.parse(b.sourceAt)-Date.parse(a.sourceAt));
    if(observations.length)return observations[0];
  }
}
