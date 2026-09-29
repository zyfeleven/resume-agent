"use client";

import { useState } from "react";
import type { AtsFormInspection } from "../lib/ats-form-inspection";
import styles from "./job-agent.module.css";
import { AtsAnswerReview } from "./ats-answer-review";
import { AtsDomPreview } from "./ats-dom-preview";
import { AtsFillPlanPreview } from "./ats-fill-plan-preview";

export function AtsFormPreview({ taskId, fingerprint, supported, approved }: { taskId: string; fingerprint: string; supported: boolean; approved: boolean }) {
  const [inspection, setInspection] = useState<AtsFormInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    setBusy(true); setError(""); setInspection(null);
    try {
      const response = await fetch("/api/agent/form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, fingerprint }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Form inspection failed.");
      setInspection(data as AtsFormInspection);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Form inspection failed."); }
    finally { setBusy(false); }
  }
  return <section className={`panel ${styles.card}`} aria-labelledby="ats-form-title">
    <h2 id="ats-form-title">Application form preflight</h2>
    <p>Read the selected Greenhouse posting's public application questions. One public request; no API key, profile data, answers, uploads or application submission.</p>
    <button type="button" className="button secondary" disabled={busy || !supported || !approved} onClick={() => void inspect()}>{busy ? "Reading public form…" : "Inspect public form"}</button>
    {!supported ? <p>Greenhouse only in this pilot. Other ATS forms require manual inspection.</p> : !approved ? <p>Review and approve the current posting in Job Agent first.</p> : null}
    {error ? <p className={styles.notice} role="alert">{error}</p> : null}
    {busy ? <p role="status">Reading only the public form schema; no browser form is opened.</p> : null}
    {inspection ? <div>
      <p role="status">{inspection.questions.length} questions · {inspection.requiredQuestionCount} required question groups · read-only question inventory</p>
      <p className={styles.caption}>Inspected {inspection.checkedAt}. This preview is not saved and clears on page refresh. Reinspect before use; it is never permission to fill or submit.</p>
      <details><summary>Scope & notices</summary><ul>{inspection.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details>
      <AtsAnswerReview key={`${inspection.taskId}:${inspection.schemaHash}`} inspection={inspection} />
      <AtsDomPreview key={`dom:${inspection.taskId}:${inspection.schemaHash}`} inspection={inspection} />
      <AtsFillPlanPreview key={`plan:${inspection.taskId}:${inspection.schemaHash}`} inspection={inspection} />
      <ol className={styles.checklist}>{inspection.questions.map((question) => <li key={question.id} className={styles.sourceSuggestion}>
        <strong>{question.label}</strong><p className={styles.caption}>{question.section} · {question.required ? "Required question" : "Optional question"} · inventory only, not live fill status</p>
        {question.description ? <p>{question.description}</p> : null}
        {question.fields.length > 1 ? <p>Alternative inputs for one question: at least one valid input is needed when required. These are not independently required fields.</p> : null}
        {question.section === "compliance" || question.section === "demographic" ? <p>Personal disclosure — your decision only. No option is selected.</p> : null}
        <ul>{question.fields.map((field) => <li key={field.name}>
          {field.name} · {field.type}{field.knownType ? "" : " · unsupported type; manual inspection"}{field.type === "input_hidden" ? " · system field; do not enter a guessed value" : ""}
          {field.options.length ? <details><summary>{field.options.length} available options (none selected)</summary><ul>{field.options.map((option, index) => <li key={`${option.value}:${index}`}>{option.label}{option.freeForm ? " — free-form response supported" : ""}</li>)}</ul></details> : null}
        </li>)}</ul>
      </li>)}</ol>
    </div> : null}
  </section>;
}
