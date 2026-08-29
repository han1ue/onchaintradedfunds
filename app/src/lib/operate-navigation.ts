export type OperateNavItem = "swap" | "funds" | "verified";
export type OperatePathView = "swap" | "funds" | "fund-detail" | "create" | "verified" | "docs";

export function navigationItemForPath(pathname: string): OperateNavItem {
  if (pathname === "/verified") return "verified";
  if (pathname === "/otfs" || pathname.startsWith("/otfs/")) return "funds";
  return "swap";
}

export function operateViewForPath(pathname: string): OperatePathView {
  if (pathname === "/create") return "create";
  if (pathname === "/verified") return "verified";
  if (pathname === "/docs") return "docs";
  if (pathname.startsWith("/otfs/")) return "fund-detail";
  if (pathname === "/otfs") return "funds";
  return "swap";
}
