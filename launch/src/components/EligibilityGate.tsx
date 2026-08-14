"use client";

import Link from "next/link";
import { BadgeCheck, ShieldAlert, Users, Watch, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ParticipationEligibility } from "@/lib/types";

type EligibilityActionProps = {
  eligibility: ParticipationEligibility;
  action: "submit" | "vote";
  callbackUrl: string;
  href?: string;
  className?: string;
  autoOpen?: boolean;
  children: ReactNode;
};

function requirementState(value: boolean | null) {
  return value === null ? "unknown" : value ? "met" : "failed";
}

function EligibilityDialog({ eligibility, action, callbackUrl, open, onClose }: Omit<EligibilityActionProps, "href" | "className" | "autoOpen" | "children"> & { open: boolean; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const accountRequirement = eligibility.verified === null || eligibility.publicAccount === null
    ? null
    : eligibility.verified && eligibility.publicAccount;
  const followerRequirement = eligibility.followersCount === null
    ? null
    : eligibility.followersCount >= eligibility.minFollowers;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function connectEligibleAccount() {
    setSwitching(true);
    setMessage(null);
    try {
      if (eligibility.connected) {
        const response = await fetch("/api/auth/x/disconnect", { method: "POST" });
        if (!response.ok) throw new Error("DISCONNECT_FAILED");
      }
      window.location.assign(`/api/auth/x?callbackUrl=${encodeURIComponent(callbackUrl)}&forceLogin=1`);
    } catch {
      setSwitching(false);
      setMessage("We couldn’t disconnect this account. Close this message and try again.");
    }
  }

  const title = eligibility.connected ? "This X account isn’t eligible" : `Sign in to ${action === "vote" ? "vote" : "submit an OTF proposal"}`;
  return <dialog ref={dialogRef} className="eligibilityDialog" onClose={onClose} onCancel={onClose} aria-labelledby="eligibility-title">
    <div className="eligibilityDialogBody">
      <button className="dialogClose" type="button" onClick={onClose} aria-label="Close eligibility requirements"><X size={17} /></button>
      <div className="eligibilityDialogIcon"><ShieldAlert size={24} aria-hidden="true" /></div>
      <h2 id="eligibility-title">{title}</h2>
      <p>To submit a proposal or vote, connect an X account that currently meets every requirement.</p>
      <div className="eligibilityRequirements">
        <div data-state={requirementState(accountRequirement)}><BadgeCheck size={17} /><strong>Verified and public</strong></div>
        <div data-state={requirementState(followerRequirement)}><Users size={17} /><strong>At least {eligibility.minFollowers.toLocaleString()} followers</strong></div>
        <div data-state={requirementState(eligibility.oldEnough)}><Watch size={17} /><strong>At least {eligibility.minAccountAgeDays} days old</strong></div>
      </div>
      <div className="eligibilityDialogActions">
        <button className="button buttonPrimary" type="button" onClick={connectEligibleAccount} disabled={switching}>{switching ? "Opening X…" : eligibility.connected ? "Use another X account" : "Sign in with X"}</button>
        <button className="button buttonSecondary" type="button" onClick={onClose}>Close</button>
      </div>
      {message && <p className="eligibilityDialogMessage" role="status">{message}</p>}
    </div>
  </dialog>;
}

export function EligibilityAction({ eligibility, action, callbackUrl, href, className = "button buttonPrimary", autoOpen = false, children }: EligibilityActionProps) {
  const [open, setOpen] = useState(autoOpen && !eligibility.eligible);
  if (eligibility.eligible && href) return <Link className={className} href={href}>{children}</Link>;
  return <>
    <button className={className} type="button" onClick={() => setOpen(true)}>{children}</button>
    <EligibilityDialog eligibility={eligibility} action={action} callbackUrl={callbackUrl} open={open} onClose={() => setOpen(false)} />
  </>;
}
