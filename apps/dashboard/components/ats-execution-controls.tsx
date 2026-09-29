"use client";

import { useEffect, useState } from "react";
import type { atsExecutionPayload } from "../lib/ats-execution";
import styles from "./job-agent.module.css";

type Payload = Awaited<ReturnType<typeof atsExecutionPayload>>;
export function AtsExecutionControls({ planId, planHash, enabled }: { planId: string; planHash: string; enabled: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [closing, setClosing] = useState(false);
  const [attachmentConsent, setAttachmentConsent] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/agent/execute?${new URLSearchParams({ planId })}`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Could not load browser status.");
      if (!controller.signal.aborted) setPayload(data);
    }).catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [endpoint]);
  async function refresh() {
    const response = await fetch(endpoint); const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Could not refresh browser status.");
    setPayload(data); setAttachmentConsent(false);
  }
  async function act(command: { action: string; [key: string]: unknown }) {
    const isClose = command.action === "close";
    if (isClose) setClosing(true); else setBusy(true);
    setError(""); setConsent(false); setAttachmentConsent(false);
    try {
      const response = await fetch("/api/agent/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Browser execution stopped.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Execution failed. Inspect partial changes before doing anything else."); }
    finally {
      try { await refresh(); } catch { setPayload(null); setError("Could not verify the latest browser state. No automatic retry. Inspect or close the browser window manually."); }
      if (isClose) setClosing(false); else setBusy(false);
    }
  }
  const record = payload?.record;
  return <section aria-labelledby="ats-execution-title" className={styles.sourceSuggestion}>
    <h4 id="ats-execution-title">Supervised offline text filling · desktop pilot</h4>
    <p>Preview approval does not authorize writing. Open a separate Chromium window, inspect it, then grant one-time permission below. Only the exact reviewed ordinary narrative answers are eligible.</p>
    <p>Before typing, this browser session's network is disabled and cannot be reconnected by the agent. It cannot save to the employer, transmit an attachment or submit an application. The window closes automatically within ten minutes of opening; closing discards its form contents.</p>
    <div className={styles.actions}>
      <button type="button" className="button secondary" disabled={!enabled || !payload || busy || closing || payload.live || !!record?.consumed}
        onClick={() => void act({ action: "open", planId, planHash })}>Open supervised browser (no typing)</button>
      <button type="button" className="text-button" disabled={busy || closing} onClick={() => { setConsent(false); void refresh().then(() => setError("")).catch(() => { setPayload(null); setError("Status refresh failed. Inspect the browser manually."); }); }}>Refresh browser status</button>
    </div>
    {record ? <>
      <p role="status">Session: {record.state.replaceAll("_", " ")} · browser {payload?.live ? "open" : "ended"} · {record.receipts.length} fields read-back verified.</p>
      <p className={styles.caption}>Authorization expires {record.expiresAt}. Browser lease ends by {record.holdExpiresAt}. Verified receipts do not mean the employer received an application.</p>
      {record.receipts.length ? <ul>{record.receipts.map(receipt => <li key={receipt.questionId}>{receipt.questionId} · read-back verified at {receipt.verifiedAt}</li>)}</ul> : null}
      {payload?.canAuthorize ? <>
        <label><input type="checkbox" checked={consent} disabled={!enabled || busy || closing} onChange={event => setConsent(event.target.checked)} /> I inspected this browser and authorize one offline fill of the exact approved text. No upload or submission.</label>
        <button type="button" className="button secondary" disabled={!consent || !enabled || busy || closing}
          onClick={() => void act({ action: "authorize", sessionId: record.id, challenge: record.challenge, planHash, confirmOfflineFill: true })}>Authorize and fill once (offline)</button>
      </> : null}
      {record.consumed ? <p>This execution permission has been consumed. Do not retry blindly after a partial result; inspect it and build a fresh preview if needed.</p> : null}
      {record.state === "filled" || record.attachment ? <section aria-labelledby="ats-attachment-title">
        <h4 id="ats-attachment-title">Verified resume attachment · offline only</h4>
        <p>Prepare the DOCX linked to this application, then review its exact hash and grant separate one-time consent. Supports a visible native resume file input, or a hidden input uniquely linked to a visible Attach label in a named Resume/CV group with an observed text alternative. Paired text must exist and remain empty; existing text is never cleared. Other hidden inputs, missing alternatives and custom buttons remain manual. This selects a local file in the offline page; it does not upload it to the employer.</p>
        <button type="button" className="button secondary" disabled={!enabled || busy || closing || !payload?.canPrepareAttachment}
          onClick={() => void act({ action: "prepare_attachment", sessionId: record.id })}>Check verified DOCX for attachment</button>
        {record.attachment ? <>
          <p>File: {record.attachment.artifact.fileName} · {record.attachment.artifact.byteSize} bytes · target: {record.attachment.target.label}</p>
          {record.attachment.target.picker ? <p>Hidden native file input: {record.attachment.target.picker.forId} · visible label: {record.attachment.target.picker.label} · verified group: {record.attachment.target.picker.groupLabel}. Authorization binds this exact association. No button will be clicked or page style changed.</p> : null}
          {record.attachment.target.alternative ? <p>File branch selected. Paired text control: {record.attachment.target.alternative.label} ({record.attachment.target.alternative.name || record.attachment.target.alternative.id}). It must remain empty before and after file selection; no text will be erased.</p> : null}
          <p className={styles.caption}>Build: {record.attachment.artifact.buildId}</p>
          <p className={styles.caption}>SHA-256: {record.attachment.artifact.outputHash}</p>
          <a href={`/api/resume/document?${new URLSearchParams({ buildId: record.attachment.artifact.buildId })}`} className="text-button">Download this DOCX for review</a>
          <p role="status">Attachment: {record.attachment.state} · {record.attachment.receipt ? "exact file bytes read-back verified locally" : "no verified attachment receipt"}</p>
          {payload?.canAttachOffline ? <>
            <label><input type="checkbox" checked={attachmentConsent} disabled={!enabled || busy || closing} onChange={event => setAttachmentConsent(event.target.checked)} /> I reviewed this exact DOCX and authorize attaching it once to this offline resume control. No employer transmission or submission.</label>
            <button type="button" className="button secondary" disabled={!attachmentConsent || !enabled || busy || closing}
              onClick={() => void act({ action: "attach_offline", sessionId: record.id, attachmentId: record.attachment!.id, attachmentHash: record.attachment!.attachmentHash, confirmOfflineAttachment: true })}>Attach verified DOCX once (offline)</button>
          </> : null}
          {record.attachment.consumed ? <p>Attachment consent has been consumed. Inspect the file control; no automatic retry.</p> : null}
        </> : null}
      </section> : null}
      <button type="button" className="text-button" disabled={closing || record.state === "closed"} onClick={() => void act({ action: "close", sessionId: record.id })}>{closing ? "Closing…" : "Stop and close supervised browser"}</button>
    </> : null}
    {busy ? <p role="status">Working on the supervised session. Once opened, the stop/close control remains available during filling.</p> : null}
    {payload?.reason ? <p role="alert">{payload.reason}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
