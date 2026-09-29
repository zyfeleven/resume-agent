/// <reference lib="dom" />
import { createHash } from "node:crypto";
import { POLICY_VERSION, evaluatePolicy } from "@resume-agent/policy";
import { openRestrictedGreenhousePage, labelledResumePicker, type ResumePicker, type GreenhouseDomSnapshot } from "./greenhouse-observer.js";
import { WriteReservations, normalizedValueHash } from "./write.js";

export interface NarrativeWrite {
  questionId: string; text: string; factIds: string[];
  target: { ref: string; id: string; name: string; label: string; tag: string; type: string };
}
export interface ResumeAttachment {
  target: NarrativeWrite["target"] & { alternative?: NarrativeWrite["target"] | undefined; picker?: ResumePicker | undefined }; buffer: Buffer; outputHash: string;
  fileName: "resume.docx"; mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
export function greenhouseEvidenceHash(snapshot: GreenhouseDomSnapshot) {
  return createHash("sha256").update(JSON.stringify([snapshot.url, snapshot.structureHash, [...snapshot.signals].sort()])).digest("hex");
}
const PRIVATE = /\b(?:name|email|phone|address|citizen\w*|visa|permit|authori[sz]\w*|sponsor\w*|salary|compensation|consent|agree|signature|certify|criminal|gender|race|religio\w*|ethnic\w*|medical|disabilit\w*|veteran|password|secret|token|api.?key|ignore|instructions?)\b/i;
type Held = Awaited<ReturnType<typeof openRestrictedGreenhousePage>>;
/** Per-session single-use field reservations. Caller must validate current local approval
 * immediately around each write. No navigation/click/submit/reconnect methods. */
export class GreenhouseTextSession {
  private reservations = new WriteReservations();
  private spent = new Set<string>();
  private frozen = false;
  constructor(private readonly held: Held, readonly expectedHash: string) {}
  get alive() { return this.held.alive; }
  async snapshot() { return this.held.snapshot(); }
  async close() { await this.held.close(); }
  async freezeNetwork() { await this.held.freezeNetwork(); this.frozen = true; }
  async assertCurrent() {
    if (!this.alive) throw new Error("The held browser session ended.");
    const snapshot = await this.snapshot();
    if (greenhouseEvidenceHash(snapshot) !== this.expectedHash || snapshot.signals.some(s => !["restricted_network_partial_view", "custom_controls_need_review"].includes(s))) throw new Error("The held page changed or needs manual takeover.");
    return snapshot;
  }
  /** Only a boolean leaves the page; never read or clear the candidate's pasted resume. */
  private async assertEmptyAlternative(target: ResumeAttachment["target"], snapshot: GreenhouseDomSnapshot) {
    const alternative = target.alternative;
    const identity = (value: string) => value.replace(/^job_application\[([^\]]+)\]$/, "$1");
    const controls = snapshot.controls.filter(c => [identity(c.id), identity(c.name)].includes("resume_text"));
    if (!alternative) {
      if (controls.length) throw new Error("An unreviewed pasted-resume alternative is present.");
      return;
    }
    if (controls.length !== 1 || alternative.ref === target.ref || controls[0]!.ref !== alternative.ref || alternative.tag !== "textarea" || alternative.type !== "textarea"
      || ["id", "name", "label", "tag", "type"].some(key => controls[0]![key as keyof NarrativeWrite["target"]] !== alternative[key as keyof NarrativeWrite["target"]])) throw new Error("The pasted-resume alternative changed.");
    const key = alternative.id ? "id" : "name"; const value = alternative.id || alternative.name;
    if (!/^[a-zA-Z0-9_:\[\]-]{1,200}$/.test(value)) throw new Error("Unsupported alternative identifier.");
    const locator = this.held.page.locator(`[${key}="${value}"]`);
    if (await locator.count() !== 1 || !await locator.evaluate((el, expected) => el instanceof HTMLTextAreaElement && el.isConnected
      && el.id === expected.id && (el.getAttribute("name") ?? "") === expected.name && el.value.length === 0, alternative)) {
      throw new Error("The pasted-resume alternative is missing or nonempty. It was not cleared.");
    }
  }
  /** Caller must have durably consumed a separately confirmed exact-artifact scope. */
  async attachResume(file: ResumeAttachment, confirmed: true) {
    if (confirmed !== true || !this.frozen || this.spent.has(file.target.ref)) throw new Error("No fresh confirmed offline attachment scope.");
    const snapshot = await this.assertCurrent(); const target = file.target;
    await this.assertEmptyAlternative(target, snapshot);
    const current = snapshot.controls.filter(c => c.ref === target.ref);
    if (target.picker && (current.length !== 1 || !target.alternative || target.alternative.id !== "resume_text"
      || JSON.stringify(labelledResumePicker(current[0]!)) !== JSON.stringify(target.picker))) throw new Error("The reviewed resume picker changed or is unsupported.");
    if (file.fileName !== "resume.docx" || file.mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || !file.buffer.length || file.buffer.length > 5_000_000 || createHash("sha256").update(file.buffer).digest("hex") !== file.outputHash
      || target.tag !== "input" || target.type !== "file" || (!target.picker && !/^(resume|cv|resume\s*\/\s*cv)\s*\*?$/i.test(target.label.trim()))) throw new Error("Unsupported or changed resume attachment.");
    if (current.length !== 1 || (!current[0]!.visible && !target.picker) || current[0]!.disabled || (["id", "name", "label", "tag", "type"] as const).some(key => current[0]![key] !== target[key])) throw new Error("The attachment target changed.");
    const key = target.id ? "id" : "name"; const value = target.id || target.name;
    if (!/^[a-zA-Z0-9_:\[\]-]{1,200}$/.test(value)) throw new Error("Unsupported attachment identifier.");
    const locator = this.held.page.locator(`[${key}="${value}"]`);
    if (await locator.count() !== 1) throw new Error("The attachment target is not unique.");
    const handle = await locator.elementHandle(); if (!handle) throw new Error("Attachment target disappeared.");
    try {
      const valid = await handle.evaluate((el, expected) => {
        if (!(el instanceof HTMLInputElement) || el.type !== "file" || !el.isConnected || el.matches(':disabled') || el.multiple || el.webkitdirectory || el.files?.length
          || el.id !== expected.id || (el.getAttribute("name") ?? "") !== expected.name || (!expected.picker && !el.getClientRects().length)) return false;
        if (expected.picker) {
          const labels = Array.from(el.labels ?? []); const group = el.closest('[role="group"],fieldset');
          const alternatives = Array.from(document.querySelectorAll('[id="resume_text"]'));
          if (!group || labels.length !== 1 || labels[0]!.control !== el || labels[0]!.htmlFor !== expected.picker.forId
            || labels[0]!.closest('[role="group"],fieldset') !== group || alternatives.length !== 1
            || !(alternatives[0] instanceof HTMLTextAreaElement) || alternatives[0].value.length !== 0
            || alternatives[0].matches(':disabled') || alternatives[0].closest('[role="group"],fieldset') !== group) return false;
        }
        const accept = el.accept.toLowerCase().split(",").map(t => t.trim()).filter(Boolean);
        return !accept.length || accept.some(t => [".docx", expected.mimeType, "application/*", "*/*"].includes(t));
      }, { ...target, mimeType: file.mimeType });
      if (!valid) throw new Error("The file control is unavailable, occupied or rejects DOCX.");
      const now = new Date().toISOString(); const origin = new URL(snapshot.url).origin;
      const policy = evaluatePolicy({ decisionId: "policy:resume-attachment", policyVersion: POLICY_VERSION, evaluatedAt: now, automationMode: "standard",
        action: { id: "attach:resume", tool: "browser_set_file", operation: "upload", targetIsFinalSubmit: false },
        origin: { targetOrigin: origin, currentOrigin: new URL(this.held.page.url()).origin, allowedOrigins: [origin] }, safetySignals: [] });
      if (policy.route !== "confirmation" || policy.approvalScope !== "upload_artifact") throw new Error("The attachment policy refused this scope.");
      const permit = this.reservations.issue({ snapshot: { snapshotId: snapshot.structureHash, pageFingerprint: this.expectedHash, pageGeneration: 0 }, targetId: target.ref, expectedValueHash: file.outputHash, issuedAt: now });
      this.reservations.consume(permit.reservationId, permit.nonce, now); this.spent.add(target.ref);
      await handle.setInputFiles({ name: file.fileName, mimeType: file.mimeType, buffer: file.buffer }, { timeout: 5000 });
      const readback = await handle.evaluate(async el => {
        if (!(el instanceof HTMLInputElement) || el.files?.length !== 1) return null;
        const file = el.files[0]!; if (file.size > 5_000_000) return null;
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
        return { name: file.name, type: file.type, size: file.size, hash };
      });
      if (!readback || readback.hash !== file.outputHash || readback.size !== file.buffer.length || readback.name !== file.fileName || readback.type !== file.mimeType) throw new Error("Attachment read-back mismatch.");
      await this.assertEmptyAlternative(target, await this.assertCurrent());
      return { reservationId: permit.reservationId, outputHash: file.outputHash, byteSize: file.buffer.length };
    } catch { throw new Error("Attachment stopped; the control may have changed. No automatic retry or employer delivery."); }
    finally { await handle.dispose(); }
  }
  async fill(row: NarrativeWrite) {
    if (!this.frozen || this.spent.has(row.target.ref)) throw new Error("No fresh single-use offline write scope is available.");
    const snapshot = await this.assertCurrent(); const target = row.target;
    if (!row.text.trim() || row.text.length > 2000 || !row.factIds.length || row.factIds.length > 20 || PRIVATE.test(`${target.label} ${target.name.replace(/_/g, " ")}`)
      || !/\b(?:describe|explain|experience|projects?|skills?|achievement|tell us|why|motivation|interest)\b/i.test(target.label)
      || !(target.tag === "textarea" && target.type === "textarea" || target.tag === "input" && target.type === "text")) throw new Error("Only approved ordinary narrative text is supported.");
    const current = snapshot.controls.filter(c => c.ref === target.ref);
    if (current.length !== 1 || !current[0]!.visible || current[0]!.disabled || ["id", "name", "label", "tag", "type"].some(key => current[0]![key as keyof typeof target] !== target[key as keyof typeof target])) throw new Error("The target no longer corresponds uniquely.");
    const key = target.id ? "id" : "name"; const value = target.id || target.name;
    if (!/^[a-zA-Z0-9_:\[\]-]{1,200}$/.test(value)) throw new Error("The observed identifier is unsupported.");
    const locator = this.held.page.locator(`[${key}="${value}"]`);
    if (await locator.count() !== 1) throw new Error("The target is no longer unique.");
    const handle = await locator.elementHandle(); if (!handle) throw new Error("The target disappeared.");
    try {
      const writable = await handle.evaluate((el, expected) => {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
        return el.isConnected && el.tagName.toLowerCase() === expected.tag && (el instanceof HTMLTextAreaElement || el.type === "text")
          && el.id === expected.id && (el.getAttribute("name") ?? "") === expected.name && !el.disabled && !el.readOnly
          && el.value.length === 0 && (el.maxLength < 0 || el.maxLength >= expected.length) && !!el.getClientRects().length;
      }, { ...target, length: row.text.length });
      if (!writable) throw new Error("The field is nonempty, readonly, changed or too short. Nothing was overwritten.");
      const now = new Date().toISOString();
      const policy = evaluatePolicy({ decisionId: `policy:${row.questionId}`, policyVersion: POLICY_VERSION, evaluatedAt: now, automationMode: "standard",
        action: { id: `fill:${row.questionId}`, tool: "browser_set_field", operation: "field_write", targetIsFinalSubmit: false },
        origin: { targetOrigin: new URL(snapshot.url).origin, currentOrigin: new URL(this.held.page.url()).origin, allowedOrigins: [new URL(snapshot.url).origin] },
        field: { observationId: target.ref, canonicalField: "candidate.application_narrative", sensitivity: "normal", confidence: 1,
          provenance: "answer_policy", factStatus: "verified", sourceCount: row.factIds.length, answerReuse: "this_application_only", tags: [] }, safetySignals: [] });
      if (policy.route !== "automatic") throw new Error("The field policy refused this write.");
      const permit = this.reservations.issue({ snapshot: { snapshotId: snapshot.structureHash, pageFingerprint: this.expectedHash, pageGeneration: 0 }, targetId: target.ref, expectedValueHash: normalizedValueHash(row.text), issuedAt: now });
      this.reservations.consume(permit.reservationId, permit.nonce, new Date().toISOString()); this.spent.add(target.ref);
      await handle.fill(row.text, { timeout: 5000 });
      const hash = await handle.evaluate(async el => {
        const value = "value" in el && typeof el.value === "string" ? el.value.trim() : "";
        return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
      });
      if (hash !== permit.expectedValueHash) throw new Error("The field did not retain the approved answer. The write may have partially occurred.");
      await this.assertCurrent();
      return { questionId: row.questionId, verified: true as const, reservationId: permit.reservationId };
    } catch { throw new Error("Field writing stopped. The field may have changed; inspect it manually. No automatic retry."); }
    finally { await handle.dispose(); }
  }
}
export async function openGreenhouseTextSession(board: string, externalId: string, expectedHash: string) {
  const held = await openRestrictedGreenhousePage(board, externalId, true, 600000);
  try {
    if (greenhouseEvidenceHash(held.initial) !== expectedHash) throw new Error("The browser no longer matches the reviewed plan.");
    const session = new GreenhouseTextSession(held, expectedHash); await session.assertCurrent(); return session;
  } catch { await held.close(); throw new Error("The reviewed page could not be held safely. Build a fresh plan."); }
}
