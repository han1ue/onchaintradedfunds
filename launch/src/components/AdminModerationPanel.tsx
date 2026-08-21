"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, ShieldAlert } from "lucide-react";
import { Button, SectionCard } from "@/components/ui";

type AdminProposal = { id: string; name: string; ticker: string; status: string };
type ModerationAction = "hidden" | "disqualified";

export function AdminModerationPanel({ proposals: initialProposals }: { proposals: AdminProposal[] }) {
  const [proposals, setProposals] = useState(initialProposals);
  const [proposalId, setProposalId] = useState(initialProposals[0]?.id ?? "");
  const [action, setAction] = useState<ModerationAction>("hidden");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const valid = Boolean(proposalId) && reason.trim().length >= 8;

  async function moderate() {
    if (!valid || busy) return;
    const selected = proposals.find((proposal) => proposal.id === proposalId);
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action, reason: reason.trim() }),
      });
      const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.code ?? "REQUEST_FAILED");
      const remaining = proposals.filter((proposal) => proposal.id !== proposalId);
      setProposals(remaining);
      setProposalId(remaining[0]?.id ?? "");
      setReason("");
      setResult({ tone: "success", message: `${selected?.name ?? "Proposal"} was ${action === "hidden" ? "hidden" : "disqualified"}. The audit record was saved.` });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_FAILED";
      const message = code === "COMPETITION_NOT_OPEN"
        ? "Moderation is available only while the competition is open."
        : code === "FORBIDDEN"
          ? "Your session is not authorized for admin actions. Sign in again with the allowlisted X account."
          : "The proposal was not changed. Check your connection and try again.";
      setResult({ tone: "error", message });
    } finally {
      setBusy(false);
    }
  }

  return <div className="adminModerationLayout">
    <SectionCard className="adminModerationCard">
      <div className="adminSectionHeading">
        <div><h2>Moderate a proposal</h2><p>Select the proposal, classify the action, and record a clear reason.</p></div>
        <ShieldAlert size={20} aria-hidden="true" />
      </div>
      {proposals.length ? <div className="adminModerationForm">
        <label className="formField"><span>Proposal</span><select value={proposalId} onChange={(event) => setProposalId(event.target.value)} disabled={busy}>{proposals.map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.name} · ${proposal.ticker} · {proposal.status}</option>)}</select></label>
        <label className="formField"><span>Action</span><select value={action} onChange={(event) => setAction(event.target.value as ModerationAction)} disabled={busy}><option value="hidden">Hide proposal</option><option value="disqualified">Disqualify proposal</option></select><small>Either action removes the proposal from public competition. Its votes remain spent and auditable but are excluded from ranking and XP.</small></label>
        <label className="formField"><span>Audit reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Explain the policy or evidence behind this action…" disabled={busy} aria-invalid={reason.length > 0 && reason.trim().length < 8} /><small>At least 8 characters. This reason is stored with the administrator and before/after state.</small></label>
        <Button className="adminModerateButton" onClick={moderate} disabled={!valid || busy}>{busy ? "Saving action…" : action === "hidden" ? "Hide proposal" : "Disqualify proposal"}</Button>
      </div> : <div className="adminEmptyState"><CheckCircle2 size={24} aria-hidden="true" /><div><strong>No active proposals</strong><p>There is nothing available to moderate.</p></div></div>}
      {result && <div className={`adminModerationResult ${result.tone}`} role={result.tone === "error" ? "alert" : "status"} aria-live="polite">{result.tone === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}<p>{result.message}</p></div>}
    </SectionCard>
    <aside className="adminAuditNote"><strong>Audit guarantee</strong><p>The proposal change and its admin action are committed together. If either write fails, neither is saved.</p></aside>
  </div>;
}
