export type OperateNavItem = "swap" | "funds";
export type OperatePathView = "swap" | "funds" | "fund-detail" | "create" | "verified" | "wallet" | "liquidity";

export function navigationItemForPath(pathname: string): OperateNavItem | undefined {
  if (pathname === "/create" || pathname === "/verified" || pathname === "/funds" || pathname.startsWith("/funds/")) return "funds";
  if (pathname === "/") return "swap";
  return undefined;
}

export function operateViewForPath(pathname: string): OperatePathView {
  if (pathname === "/create") return "create";
  if (pathname === "/verified") return "verified";
  if (pathname === "/wallet") return "wallet";
  if (pathname === "/liquidity") return "liquidity";
  if (pathname.startsWith("/funds/")) return "fund-detail";
  if (pathname === "/funds") return "funds";
  return "swap";
}
