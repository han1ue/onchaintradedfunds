 "use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

function isAppRoute(pathname: string): boolean {
  if (pathname === "/") return false;
  return (
    pathname.startsWith("/otfs") ||
    pathname === "/create" ||
    pathname === "/wallet" ||
    pathname === "/verified" ||
    pathname === "/liquidity"
  );
}

export function AppTopBanner() {
  const pathname = usePathname();
  const showBanner = isAppRoute(pathname);

  useEffect(() => {
    if (showBanner) {
      document.body.style.removeProperty("--testnet-banner-height");
    } else {
      document.body.style.setProperty("--testnet-banner-height", "0px");
    }
  }, [showBanner]);

  if (!showBanner) {
    return null;
  }

  return (
    <aside className="testnetWarningBanner" aria-label="Testnet risk warning">
      <div>
        <AlertTriangle aria-hidden="true" size={13} strokeWidth={2.2} />
        <strong>Testnet</strong>
        <span className="testnetWarningDesktop">
          Contracts may be redeployed. Assets may be lost.
        </span>
        <span className="testnetWarningMobile">
          Contracts may be redeployed. Assets may be lost.
        </span>
      </div>
    </aside>
  );
}
