"use client";

import { useEffect, useState } from "react";
import type { atsFillPayload } from "../lib/ats-fill-plan";
import type { AtsFormInspection } from "../lib/ats-form-inspection";
import { AtsExecutionControls } from "./ats-execution-controls";
import styles from "./job-agent.module.css";

type Payload = Awaited<ReturnType<typeof atsFillPayload>>;
export function AtsFillPlanPreview({ inspection }: { inspection: AtsFormInspection }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [blocked, setBlocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const expiresAt = payload?.plan?.expiresAt;
  useEffect(() => {
    if (!expiresAt) { setExpired(false); return; }
    const remaining = Date.parse(expiresAt) - Date.now();
    setExpired(!Number.isFinite(remaining) || remaining <= 0);
    if (Number.isFinite(remaining) && remaining > 0) {
      const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2147483647));
      return () => clearTimeout(timer);
    }
  }, [expiresAt]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/agent/fill-plan?${new URLSearchParams({ taskId: inspection.taskId, schemaHash: inspection.schemaHash })}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Could not load the saved plan."); if (!controller.signal.aborted) setPayload(data); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [inspection.taskId, inspection.schemaHash]);
  async function act(command: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/fill-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Plan operation failed.");
      setPayload(data.deleted ? { plan: null, staleReason: null, canApprovePreview: false, canFill: false, canUpload: false, canSubmit: false } : data); setBlocked(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Plan operation failed."); setBlocked(true); }
    finally { setBusy(false); }
  }
  const plan = payload?.plan; const decision = plan?.reviews.at(-1)?.decision ?? "pending";
  return <section className={styles.task} aria-labelledby="ats-fill-plan-title">
    <h3 id="ats-fill-plan-title">Reviewed-answer plan preview</h3>
    <p>Combine your approved narrative answers with a fresh hosted-page observation. No Gemini request and no answer text sent to the browser or employer. Build and approve-preview actions each reopen the read-only browser and check the public form twice.</p>
    <p className={styles.caption}>The preview lasts five minutes. Building again replaces this task's saved preview and its review history. Approval records review of the displayed plan only — it does not authorize typing, uploads or submission. Ordinary text filling requires separate one-time consent below.</p>
    <button type="button" className="button secondary" disabled={busy || !payload} onClick={() => void act({ action: "build", taskId: inspection.taskId, fingerprint: inspection.postingFingerprint, schemaHash: inspection.schemaHash })}>{busy ? "Working…" : plan ? "Rebuild plan from approved answers" : "Build plan from approved answers"}</button>
    {busy ? <p role="status">Checking the plan; no application fields are being changed.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {payload?.staleReason ? <p role="alert">Stale preview: {payload.staleReason}</p> : null}
    {expired && !payload?.staleReason ? <p role="alert">This preview has expired. Build a new preview before approval.</p> : null}
    {blocked ? <p role="alert">Do not use the old preview. Resolve the error and rebuild before approval.</p> : null}
    {plan ? <div>
      <p>{plan.rows.filter(row => row.status === "planned").length} approved answers mapped · {plan.rows.filter(row => row.status === "manual").length} questions remain manual · review: {decision}</p>
      <p className={styles.caption}>Observed {plan.observedAt} · expires {plan.expiresAt}. Reload checks local evidence only; the saved preview is not a live browser session.</p>
      {plan.blockers.length ? <div role="alert"><p>Preview approval blocked:</p><ul>{plan.blockers.map(reason => <li key={reason}>{reason.replaceAll("_", " ")}</li>)}</ul></div> : null}
      {plan.limitations.length ? <details><summary>Observation limitations ({plan.limitations.length})</summary><ul>{plan.limitations.map(reason => <li key={reason}>{reason.replaceAll("_", " ")}</li>)}</ul></details> : null}
      {plan.rows.map(row => <article key={row.questionId} className={styles.sourceSuggestion}>
        <h4>{row.label}{row.required ? " · required" : ""}</h4><p>{row.reason}</p>
        {row.status === "planned" ? <><blockquote>{row.text}</blockquote><p className={styles.caption}>Observed target: {row.target?.label} · {row.target?.tag}/{row.target?.type} · id: {row.target?.id || "none"} · name: {row.target?.name || "none"}</p><p className={styles.caption}>Verified fact references: {row.factIds.join(", ")}</p></> : <p>No answer will be inferred or inserted for this question.</p>}
      </article>)}
      <details><summary>Additional unplanned controls ({plan.extraControls.length})</summary><ul>{plan.extraControls.map((control, index) => <li key={index}>{control.label} · {control.type}{control.required ? " · required" : ""}</li>)}</ul></details>
      <div className={styles.actions}>
        <button type="button" className="button secondary" disabled={busy || blocked || expired || !payload?.canApprovePreview || decision === "approved"} onClick={() => void act({ action: "review", planId: plan.id, planHash: plan.planHash, decision: "approved" })}>Approve preview only</button>
        <button type="button" className="button secondary" disabled={busy || decision === "rejected"} onClick={() => void act({ action: "review", planId: plan.id, planHash: plan.planHash, decision: "rejected" })}>Reject preview</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void act({ action: "delete", planId: plan.id, planHash: plan.planHash })}>Delete saved preview</button>
      </div>
      <AtsExecutionControls key={plan.id} planId={plan.id} planHash={plan.planHash} enabled={!busy && !blocked && !expired && !!payload?.canApprovePreview && decision === "approved"} />
    </div> : null}
  </section>;
}
