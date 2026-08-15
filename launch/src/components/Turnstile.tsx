"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: { render(container: HTMLElement, options: { sitekey: string; action: string; theme: "auto"; size: "normal" | "flexible" | "compact"; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void }): string; reset(widgetId: string): void };
  }
}

export function Turnstile({ siteKey, action, resetKey, onToken }: { siteKey?: string; action: "submit_otf" | "vote_otf"; resetKey: number; onToken(token: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const widgetId = useRef<string | null>(null);
  const [complete, setComplete] = useState(false);
  const render = useCallback(() => {
    if (!siteKey || !container.current || !window.turnstile || rendered.current) return;
    rendered.current = true;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      theme: "auto",
      size: "flexible",
      callback: (token) => { setComplete(true); onToken(token); },
      "expired-callback": () => { setComplete(false); onToken(""); },
      "error-callback": () => { setComplete(false); onToken(""); }
    });
  }, [action, siteKey, onToken]);
  useEffect(() => {
    if (!resetKey || !widgetId.current || !window.turnstile) return;
    window.turnstile.reset(widgetId.current);
    setComplete(false);
    onToken("");
  }, [onToken, resetKey]);
  if (!siteKey) return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} /><div className={`turnstile${complete ? " turnstileComplete" : ""}`} aria-hidden={complete} ref={container} /></>;
}
