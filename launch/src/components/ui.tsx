import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionCard({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`sectionCard ${className}`} {...props} />;
}

export function StatusBadge({ children, tone = "neutral", href }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "danger"; href?: string }) {
  const classes = `statusBadge ${tone}${href ? " statusBadgeLink" : ""}`;
  return href ? <Link className={classes} href={href}>{children}</Link> : <span className={classes}>{children}</span>;
}

export function Button({ href, children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { href?: string; variant?: "primary" | "secondary" | "ghost" }) {
  const classes = `button button${variant[0].toUpperCase()}${variant.slice(1)} ${className}`;
  return href ? <Link className={classes} href={href}>{children}</Link> : <button className={classes} {...props}>{children}</button>;
}

export function Callout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "positive" | "warning" | "danger" }) {
  return <div className={`callout ${tone}`}>{children}</div>;
}

export function MetricCard({ label, value, detail, href }: { label: string; value: string; detail?: string; href?: string }) {
  return <div className="metricCard"><span>{label}</span>{href ? <Link className="metricCardLink" href={href} aria-label={`${label}: ${value}`}><strong>{value}</strong><ArrowRight size={15} /></Link> : <strong>{value}</strong>}{detail && <small>{detail}</small>}</div>;
}
