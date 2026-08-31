type OperateNavItem = "swap" | "funds" | "token";

export function navigationItemForPath(pathname: string): OperateNavItem | undefined {
  if (pathname === "/create" || pathname === "/verified" || pathname === "/funds" || pathname.startsWith("/funds/")) return "funds";
  if (pathname === "/token") return "token";
  if (pathname === "/") return "swap";
  return undefined;
}
