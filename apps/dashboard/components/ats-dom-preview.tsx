"use client";

import { useState } from "react";
import type { AtsFormInspection } from "../lib/ats-form-inspection";
import type { observeApplicationPage } from "../lib/ats-dom-observation";
import styles from "./job-agent.module.css";

export function AtsDomPreview({ inspection }: { inspection: AtsFormInspection }) {
  const [result, setResult] = useState<(Awaited<ReturnType<typeof observeApplicationPage>> & { offlineWidgetProbe?: boolean }) | null>(null);
  const [probeConsent, setProbeConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function observe(probe = false) {
    if (probe && !probeConsent) return;
    setBusy(true); setError(""); setResult(null); setProbeConsent(false);
    try {
      const response = await fetch("/api/agent/observe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: inspection.taskId, fingerprint: inspection.postingFingerprint, schemaHash: inspection.schemaHash, ...(probe ? { action: 'probe_resume_widget', confirmOfflineSwitch: true } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Observation failed.");
      setResult(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Observation failed."); }
    finally { setBusy(false); }
  }
  return <section className={styles.task} aria-labelledby="ats-dom-title">
    <h3 id="ats-dom-title">Hosted page observation</h3>
    <p>Open an isolated temporary Chromium browser to read this posting's actual controls. No model key, profile, saved login, typing, clicking, uploads or submission. Two public form checks surround the browser read; the browser closes automatically.</p>
    <p className={styles.caption}>Restricted network: only this canonical Greenhouse page and fixed presentation assets may load. Third-party services and non-GET requests are blocked, so this can be a partial view. CAPTCHA, login, frames and custom controls need manual inspection; nothing is bypassed.</p>
    <button type="button" className="button secondary" disabled={busy} onClick={() => void observe()}>{busy ? "Observing page…" : "Observe hosted page (read only)"}</button>
    <details><summary>Inspect an unmounted resume-text alternative (offline)</summary>
      <p>This separate diagnostic opens a fresh temporary browser, disables all networking, then clicks only the supported Resume/CV group's Enter manually button once. It supplies no text or files and closes the browser afterward. Results cannot authorize filling or attachment; unsupported widgets stop without retry.</p>
      <label><input type="checkbox" checked={probeConsent} disabled={busy} onChange={event => setProbeConsent(event.target.checked)} /> I authorize this one offline widget switch for inspection only.</label>
      <button type="button" className="button secondary" disabled={busy || !probeConsent} onClick={() => void observe(true)}>Inspect resume text switch (offline)</button>
    </details>
    {busy ? <p role="status">Inspecting a temporary browser; no candidate text, files or application submission.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result ? <div>
      <p role="status">{result.snapshot.controls.length} controls observed · {result.snapshot.observedAt} · no fields filled</p>
      {result.offlineWidgetProbe ? <p role="status">Offline switch inspection completed; the temporary browser is closed. Diagnostic only — this changed snapshot cannot be used as a fill or upload plan.</p> : null}
      <p>Snapshot only; not proof the entire form is complete or permission to use these controls. Refresh or a failed new observation clears this preview.</p>
      {result.snapshot.signals.length ? <div role="alert"><p>Manual inspection / observation limits:</p><ul>{result.snapshot.signals.map(signal => <li key={signal}>{signal.replaceAll("_", " ")}</li>)}</ul></div> : null}
      <ol className={styles.checklist}>{result.questions.map(question => <li key={question.questionId}><strong>{question.label}</strong><ul>{question.fields.map(field => <li key={field.name}>{field.name}: {field.status.replaceAll("_", " ")} — {field.reason}</li>)}</ul></li>)}</ol>
      <details><summary>Additional controls ({result.extraControls.length})</summary><ul>{result.extraControls.map(control => <li key={control.ref}>{control.label} · {control.type}{control.required ? " · required" : ""} · not mapped or authorized</li>)}</ul></details>
    </div> : null}
  </section>;
}
