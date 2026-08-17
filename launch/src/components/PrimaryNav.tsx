"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", secondary: true },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/vote", label: "Vote" },
  { href: "/xp", label: "XP" },
  { href: "/rules", label: "Rules", secondary: true }
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname();

  return <nav className="primaryNav" aria-label="Primary navigation">
    {items.map((item) => {
      const active = isActive(pathname, item.href);
      return <Link
        key={item.href}
        href={item.href}
        className={`${active ? "active" : ""}${item.secondary ? " navSecondary" : ""}`}
        aria-current={active ? "page" : undefined}
      >{item.label}</Link>;
    })}
  </nav>;
}
