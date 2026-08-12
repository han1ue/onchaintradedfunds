"use client";

import Script from "next/script";
import { useCallback, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render(container: HTMLElement, options: { sitekey: string; theme: "auto"; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void }): string };
  }
}

export function Turnstile({ siteKey, onToken }: { siteKey?: string; onToken(token: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const render = useCallback(() => {
    if (!siteKey || !container.current || !window.turnstile || rendered.current) return;
    rendered.current = true;
    window.turnstile.render(container.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken("")
    });
  }, [siteKey, onToken]);
  if (!siteKey) return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} /><div className="turnstile" ref={container} /></>;
}
