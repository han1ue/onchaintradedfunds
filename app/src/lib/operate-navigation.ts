export type OperateNavItem = "swap" | "funds";
export type OperatePathView = "swap" | "funds" | "fund-detail" | "create" | "verified" | "wallet";

export function navigationItemForPath(pathname: string): OperateNavItem {
  if (pathname === "/create" || pathname === "/verified" || pathname === "/otfs" || pathname.startsWith("/otfs/")) return "funds";
  return "swap";
}

export function operateViewForPath(pathname: string): OperatePathView {
  if (pathname === "/create") return "create";
  if (pathname === "/verified") return "verified";
  if (pathname === "/wallet") return "wallet";
  if (pathname.startsWith("/otfs/")) return "fund-detail";
  if (pathname === "/otfs") return "funds";
  return "swap";
}
