/// <reference lib="dom" />
import { openRestrictedGreenhousePage, type GreenhouseDomSnapshot } from "./greenhouse-observer.js";
import { requireAutomaticDecision } from "./policy-gate.js";

const allowedSignals = new Set(["restricted_network_partial_view", "custom_controls_need_review"]);
/** Only fixed, value-free diagnostic messages may cross the dashboard boundary. */
export class ResumeWidgetProbeError extends Error {}
/** Ephemeral diagnostic only. No candidate data, held session, file selection or reusable write evidence. */
export async function probeGreenhouseResumeWidget(board: string, externalId: string, confirmed: true,
  open = openRestrictedGreenhousePage): Promise<GreenhouseDomSnapshot> {
  if (confirmed !== true) throw new ResumeWidgetProbeError("Separate offline widget-probe consent is required.");
  const held = await open(board, externalId);
  let stage = 'preflight';
  try {
    const initial = held.initial;
    if (initial.signals.some(s => !allowedSignals.has(s))) throw new Error("Manual condition.");
    const files = initial.controls.filter(c => c.id === "resume" || c.name === "resume" || c.name === "job_application[resume]");
    const file = files.length === 1 ? files[0] : undefined; const group = file?.upload?.group;
    if (!file || file.tag !== "input" || file.type !== "file" || file.id !== "resume" || file.disabled
      || !group || group.labelStatus !== "explicit" || !/^(resume|cv|resume\s*\/\s*cv)\s*\*?$/i.test(group.label.trim())
      || group.fieldIds.length !== 1 || group.fieldIds[0] !== "resume"
      || group.triggerTargets.length !== 2 || !["resume", "resume_text"].every(id => group.triggerTargets.filter(v => v === id).length === 1)
      || initial.controls.some(c => c.id === "resume_text" || ["resume_text", "job_application[resume_text]"].includes(c.name))) throw new Error("Unsupported widget.");
    // Lock all routes and the context BEFORE the only permitted mutation.
    stage = 'network lock'; await held.freezeNetwork();
    const before = await held.snapshot();
    if (before.structureHash !== initial.structureHash || before.signals.some(s => !allowedSignals.has(s))) throw new Error("Page changed.");
    stage = 'switch association';
    const groups = held.page.locator('[role="group"],fieldset').filter({ has: held.page.locator('input[id="resume"]') });
    if (await groups.count() !== 1) throw new Error("Ambiguous group.");
    const owner = await groups.elementHandle();
    const buttons = groups.getByRole('button', { name: 'Enter manually', exact: true });
    if (!owner || await buttons.count() !== 1) throw new Error("Ambiguous switch.");
    const button = await buttons.elementHandle(); if (!button) throw new Error("Missing switch.");
    try {
      const valid = await button.evaluate(el => {
        if (!(el instanceof HTMLButtonElement) || el.getAttribute('type') !== 'button' || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return false;
        const group = el.closest('[role="group"],fieldset'); const parent = el.parentElement;
        const files = document.querySelectorAll('[id="resume"]');
        if (!group || !parent || files.length !== 1 || !(files[0] instanceof HTMLInputElement) || files[0].files?.length
          || files[0].closest('[role="group"],fieldset') !== group || document.querySelector('[id="resume_text"],[name="resume_text"],[name="job_application[resume_text]"]')) return false;
        const labels = parent.querySelectorAll('label');
        return labels.length === 1 && labels[0]!.htmlFor === 'resume_text' && labels[0]!.textContent?.trim() === 'Enter manually'
          && parent.querySelectorAll('button,input,textarea,select,a,[role="button"]').length === 1;
      });
      if (!valid) throw new Error("Unsupported switch association.");
      requireAutomaticDecision({ tool: "browser_activate", actionId: "probe:resume-text", decisionId: "policy:resume-widget-probe", evaluatedAt: new Date().toISOString(),
        targetOrigin: new URL(initial.url).origin, currentOrigin: new URL(held.page.url()).origin, allowedOrigins: [new URL(initial.url).origin], safetySignals: [], automationMode: "standard" });
      stage = 'offline click';
      await button.click({ timeout: 3000 }); // One native actionability-checked click; no retry/force/evaluate-click.
      stage = 'revealed control';
      const text = held.page.locator('[id="resume_text"]'); await text.waitFor({ state: 'attached', timeout: 3000 });
      if (await text.count() !== 1 || !await owner.evaluate(el => {
        const text = document.querySelector('[id="resume_text"]');
        return el.isConnected && text instanceof HTMLTextAreaElement && text.closest('[role="group"],fieldset') === el && text.value.length === 0;
      })) throw new Error("Alternative missing, moved or nonempty.");
      stage = 'post-switch observation'; const after = await held.snapshot();
      if (after.signals.some(s => !allowedSignals.has(s))) throw new Error("Manual condition after switch.");
      return { ...after, signals: [...after.signals, "offline_widget_probe_not_fill_evidence"], canFill: false, canSubmit: false };
    } finally { await button.dispose(); await owner.dispose(); }
  } catch {
    throw new ResumeWidgetProbeError(`Offline resume-widget inspection stopped (${stage}). No values or files were supplied. The temporary browser closes without retry; inspect this widget manually.`);
  } finally { await held.close(); }
}
