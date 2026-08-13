import type { ReactNode } from "react";
import Link from "next/link";
import { XMark } from "./XMark";

export function XSignInButton({
  children = "Sign in with X",
  redirectTo = "/",
  variant = "primary",
  className = "",
  showMark = false
}: {
  children?: ReactNode;
  redirectTo?: string;
  variant?: "primary" | "secondary";
  className?: string;
  showMark?: boolean;
}) {
  const href = `/api/auth/x?callbackUrl=${encodeURIComponent(redirectTo)}`;
  return <Link
    href={href}
    className={`button button${variant[0].toUpperCase()}${variant.slice(1)} ${className}`}
  >
    {showMark ? <XMark /> : null}
    {children}
  </Link>;
}
