"use client";

import type { ReactNode } from "react";
import { signIn } from "next-auth/react";
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
  return <button
    type="button"
    className={`button button${variant[0].toUpperCase()}${variant.slice(1)} ${className}`}
    onClick={() => void signIn("twitter", { redirectTo })}
  >
    {showMark ? <XMark /> : null}
    {children}
  </button>;
}
