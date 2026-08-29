type OperateNavItem = "swap" | "funds";

export function navigationItemForPath(pathname: string): OperateNavItem | undefined {
  if (pathname === "/create" || pathname === "/verified" || pathname === "/funds" || pathname.startsWith("/funds/")) return "funds";
  if (pathname === "/") return "swap";
  return undefined;
}
