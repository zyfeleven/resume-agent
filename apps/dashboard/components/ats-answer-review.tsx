"use client";

import { useEffect, useState } from "react";
import type { AtsFormInspection } from "../lib/ats-form-inspection";
import type { atsAnswerPayload } from "../lib/ats-answer-plan";
import styles from "./job-agent.module.css";

type Payload = Awaited<ReturnType<typeof atsAnswerPayload>>;
export function AtsAnswerReview({ inspection }: { inspection: AtsFormInspection }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewBlocked, setReviewBlocked] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch(`/api/agent/answers?${new URLSearchParams({ taskId: inspection.taskId, schemaHash: inspection.schemaHash })}`).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Could not load saved answers.");
      if (active) setPayload(data);
    }).catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [inspection.taskId, inspection.schemaHash]);
  async function act(command: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/answers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Answer operation failed.");
      setPayload(data.deleted ? (current) => current ? { ...current, plan: null, citations: [], stale: false } : current : data);
      setReviewBlocked(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Answer operation failed."); setReviewBlocked(true); }
    finally { setBusy(false); }
  }
  const plan = payload?.plan;
  return <section className={styles.task} aria-labelledby="ats-answer-title">
    <h3 id="ats-answer-title">Gemini answer drafts</h3>
    <p>Draft ordinary narrative answers from verified, non-sensitive facts. Contact details, eligibility, options, attachments and consent stay manual. Drafting makes one Gemini request and checks the public form before and after; each review rechecks the public form without a model call.</p>
    <p className={styles.caption}>Saved locally with your decisions. Generating again replaces this task's previous drafts and reviews. Review approves wording only — never filling, uploading or submitting.</p>
    <div className={styles.actions}>
      <button type="button" className="button secondary" disabled={busy || !payload?.intelligence.configured} onClick={() => void act({ action: "generate", taskId: inspection.taskId, fingerprint: inspection.postingFingerprint, schemaHash: inspection.schemaHash })}>{busy ? "Working…" : plan ? "Replace with new Gemini drafts" : "Draft answers with Gemini"}</button>
      {plan ? <button type="button" className="text-button" disabled={busy} onClick={() => void act({ action: "delete", planId: plan.id, planHash: plan.planHash })}>Delete saved drafts</button> : null}
    </div>
    {payload && !payload.intelligence.configured ? <p>Add GEMINI_API_KEY on the server to generate drafts. Saved drafts can still be reviewed without a model key.</p> : null}
    {error ? <p className={styles.notice} role="alert">{error}</p> : null}
    {payload?.stale || reviewBlocked ? <p role="alert">Do not use this plan yet. Refresh the form and resolve the error; changed evidence requires new drafts.</p> : null}
    {plan ? <div><p className={styles.caption}>Generated {plan.generatedAt} · {plan.model} · no ATS fields filled</p>
      {plan.answers.map((answer) => {
        const decision = [...plan.reviews].reverse().find((review) => review.questionId === answer.questionId)?.decision ?? "pending";
        return <article className={styles.sourceSuggestion} key={answer.questionId}>
          <h4>{answer.label}</h4><p>{answer.reason}</p>
          {answer.disposition === "draft" ? <>
            <blockquote>{answer.text}</blockquote><p>Wording review: {decision}</p>
            <details><summary>Verified evidence ({answer.factIds.length})</summary><ul>{answer.factIds.map((id) => <li key={id}>{payload?.citations.find((fact) => fact.id === id)?.value ?? "Evidence is stale or no longer available."}</li>)}</ul><a href="/profile">Review source facts</a></details>
            <div className={styles.actions}>{(["approved", "rejected"] as const).map((value) => <button key={value} type="button" className="button secondary" disabled={busy || payload?.stale || reviewBlocked || decision === value} onClick={() => void act({ action: "review", planId: plan.id, planHash: plan.planHash, questionId: answer.questionId, decision: value })}>{value === "approved" ? "Approve wording" : "Reject draft"}</button>)}</div>
          </> : <p className={styles.caption}>Manual answer needed; nothing has been inferred or accepted.</p>}
        </article>;
      })}
    </div> : null}
  </section>;
}
