export type StoredFundSnapshot = {
  id: string; block_number: string; block_hash: string; block_at: string; slot_at: string;
  total_supply: string; total_nav_usd: string | null; nav_per_share_usd: string | null;
  bootstrap_nav_usd: string | null; status: "ready" | "bootstrap" | "unpriced";
};
export type FundHistoryResponse = {
  latest: StoredFundSnapshot | null;
  history: StoredFundSnapshot[];
  holdings: { address: string; amount: string; bootstrap_amount: string | null; decimals: number; price_id: string | null; price_usd: string | null; source_at: string | null; source_id: string | null; market_cap_usd?: string | null; market_cap_at?: string | null }[];
};
export function chartHistory(rows: readonly StoredFundSnapshot[]) {
  return rows.filter(row => row.status === "ready" && row.nav_per_share_usd !== null && row.total_nav_usd !== null)
    .map(row => ({ at: Date.parse(row.block_at), navUsd: Number(row.nav_per_share_usd), aumUsd: Number(row.total_nav_usd) }));
}
