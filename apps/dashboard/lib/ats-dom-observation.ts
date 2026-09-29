import { observeGreenhousePage, greenhouseTarget, type GreenhouseDomSnapshot, type ObservedControl } from "@resume-agent/browser-runner/greenhouse-observer";
import { inspectApplicationForm, FormInspectionError, type AtsFormInspection } from "./ats-form-inspection";
import { readDiscoveryStore } from "./discovery-store";
import { probeGreenhouseResumeWidget, ResumeWidgetProbeError } from "@resume-agent/browser-runner/greenhouse-widget-probe";

const normalize = (text: string) => text.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();
const identity = (text: string) => text.replace(/^job_application\[([^\]]+)\]$/, "$1");
function compatible(type: string, control: ObservedControl) {
  if (type === "input_text") return control.tag === "input" && ["text", "email", "tel", "url", "number"].includes(control.type);
  if (type === "textarea") return control.tag === "textarea";
  if (type === "input_file") return control.type === "file";
  if (type === "input_hidden") return control.type === "hidden";
  if (type === "multi_value_single_select") return control.tag === "select" || control.type === "combobox";
  if (type === "multi_value_multi_select") return control.tag === "select" && control.type === "select-multiple";
  return false;
}
/** Evidence correspondence only, never selectors or authority to write. Matching requires
 * a unique exact name/id and matching label/type; ambiguous candidates stay explicit. */
export function reconcileGreenhouseDom(form: AtsFormInspection, snapshot: GreenhouseDomSnapshot) {
  const used = new Set<string>();
  const questions = form.questions.map(question => ({ questionId: question.id, label: question.label, required: question.required,
    fields: question.fields.map(field => {
      const candidates = snapshot.controls.filter(c => [identity(c.id), identity(c.name)].includes(field.name));
      const control = candidates.length === 1 ? candidates[0]! : null;
      candidates.forEach(c => used.add(c.ref));
      let status: "corresponding" | "missing" | "ambiguous" | "needs_review" = "missing";
      let reason = "No exact DOM name/id observed; do not guess a selector.";
      if (!candidates.length && snapshot.controls.some(c => c.upload?.group?.triggerTargets.includes(field.name))) {
        reason = "A file-group label refers to this alternative, but its control is not mounted in the observed page. Manual activation and a fresh observation are required; no control was clicked.";
      }
      const shared = control && form.questions.flatMap(q => q.fields).filter(f => [identity(control.id), identity(control.name)].includes(f.name)).length > 1;
      if (candidates.length > 1 || shared) { status = "ambiguous"; reason = "Identifiers are shared across controls or questions; manual inspection required."; }
      else if (control) {
        const labelsMatch = normalize(control.label) === normalize(question.label);
        const optionsMatch = field.options.length === control.optionLabels.length && field.options.every((o, i) => normalize(o.label) === normalize(control.optionLabels[i] ?? ""));
        const basic = field.knownType && compatible(field.type, control) && labelsMatch && control.visible && !control.disabled
          && field.type !== "input_hidden" && control.type !== "combobox" && (field.options.length === 0 || optionsMatch);
        // Required groups with alternative inputs cannot be inferred from each DOM required flag.
        const requiredMatches = question.fields.length === 1 && control.required === question.required;
        status = basic && requiredMatches ? "corresponding" : "needs_review";
        reason = status === "corresponding" ? "Unique identifier, label, type and required flag correspond. Observation only; no filling is authorized."
          : "Label, type, options, required grouping, visibility or availability needs manual reconciliation.";
        if (field.type === "input_file") {
          const details: string[] = [];
          if (!control.visible) details.push("The file input is visually hidden or clipped; the visible Attach label is not the file control.");
          if (control.disabled) details.push("The file input is disabled.");
          const upload = control.upload;
          if (upload) {
            const acceptsDocx = !upload.accept.length || upload.accept.some(a => [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/*", "*/*"].includes(a.toLowerCase()));
            if (upload.multiple || upload.directory) details.push("Multiple-file or directory selection is unsupported.");
            if (!acceptsDocx) details.push("The declared file filter does not accept DOCX.");
            const group = upload.group;
            if (group) {
              details.push(group.labelStatus === "explicit" ? `Named upload group: ${group.label}. Group naming does not replace the individual control label or grant attachment permission.` : "The upload group has a missing or ambiguous accessible label.");
              if (question.fields.some(f => f.name !== field.name && group.triggerTargets.includes(f.name) && !group.fieldIds.includes(f.name))) details.push("A declared alternative is not mounted; no empty-text check is possible yet.");
            }
            if (upload.multiple || upload.directory || !acceptsDocx || group && (group.labelStatus !== "explicit" || normalize(group.label) !== normalize(question.label))) {
              status = "needs_review";
              reason = "The file control requires manual handling.";
            }
          }
          if (details.length) reason += " " + details.join(" ");
        }
      }
      return { name: field.name, status, reason, controls: candidates.map(c => c.ref) };
    }),
  }));
  return { questions, extraControls: snapshot.controls.filter(c => !used.has(c.ref)).map(c => ({ ref: c.ref, label: c.label || "Unlabelled control", type: c.type, required: c.required })) };
}
async function binding(taskId: string, fingerprint: string) {
  const store = await readDiscoveryStore(); const task = store.tasks.find(t => t.id === taskId);
  const job = store.jobs.find(j => j.id === task?.candidateId);
  if (!task || !job || job.provider !== "greenhouse" || job.availability !== "open" || job.decision !== "approved"
    || job.fingerprint !== fingerprint || job.decisionHash !== fingerprint || task.approvedHash !== fingerprint
    || ["cancelled", "needs_reapproval"].includes(task.state)) throw new FormInspectionError("Review and approve the current Greenhouse posting before browser observation.", 409);
  const target = greenhouseTarget(job.board, job.externalId);
  // Custom career-site URLs, tracking parameters and legacy hosts require their own adapter.
  if (job.url !== target) throw new FormInspectionError("This pilot observes canonical job-boards.greenhouse.io posting URLs only. Inspect this custom or legacy URL manually.");
  return { target, board: job.board, externalId: job.externalId, approval: task.approvedAt, job: JSON.stringify(job) };
}
let busy = false;
export async function probeApplicationResumeWidget(taskId: string, fingerprint: string, schemaHash: string, confirmed: true,
  probe = probeGreenhouseResumeWidget, inspect = inspectApplicationForm) {
  if (confirmed !== true) throw new FormInspectionError("Confirm the separate offline widget inspection first.", 400);
  const checkedInspect: typeof inspectApplicationForm = async (...args) => {
    const form = await inspect(...args);
    const resumes = form.questions.filter(q => q.section === 'application' && /^(resume|cv|resume\s*\/\s*cv)\s*\*?$/i.test(q.label.trim()));
    if (resumes.length !== 1 || resumes[0]!.fields.length !== 2 || ![['resume', 'input_file'], ['resume_text', 'textarea']].every(([name, type]) =>
      resumes[0]!.fields.some(f => f.name === name && f.type === type && f.knownType && !f.options.length))) throw new FormInspectionError("Only the known Resume/CV file/text group can be inspected this way.", 409);
    if (form.questions.flatMap(q => q.fields).filter(f => ['resume', 'resume_text'].includes(f.name)).length !== 2) throw new FormInspectionError("Resume fields are shared across questions. Inspect manually.", 409);
    return form;
  };
  const result = await observeApplicationPage(taskId, fingerprint, schemaHash, async (board, id) => {
    try { return await probe(board, id, true); }
    catch (error) { if (error instanceof ResumeWidgetProbeError) throw new FormInspectionError(error.message, 409); throw error; }
  }, checkedInspect);
  return { ...result, offlineWidgetProbe: true as const };
}
export async function observeApplicationPage(taskId: string, fingerprint: string, schemaHash: string,
  observer = observeGreenhousePage, inspect = inspectApplicationForm) {
  if (busy) throw new FormInspectionError("A hosted-page observation is already running. Wait before retrying.", 409);
  busy = true;
  try {
    const before = await binding(taskId, fingerprint);
    const form = await inspect(taskId, fingerprint);
    if (form.schemaHash !== schemaHash) throw new FormInspectionError("The public form changed. Inspect it again before opening the browser.", 409);
    if (JSON.stringify(await binding(taskId, fingerprint)) !== JSON.stringify(before)) throw new FormInspectionError("The approval changed before browser observation.", 409);
    const snapshot = await observer(before.board, before.externalId);
    if (snapshot.url !== before.target) throw new FormInspectionError("The observed URL does not match this posting.", 409);
    // Revalidate both local authorization and source schema after asynchronous page loading.
    const afterForm = await inspect(taskId, fingerprint);
    if (afterForm.schemaHash !== schemaHash || JSON.stringify(await binding(taskId, fingerprint)) !== JSON.stringify(before)) {
      throw new FormInspectionError("The posting, form or approval changed during observation. No snapshot was retained.", 409);
    }
    return { taskId, fingerprint, schemaHash, snapshot, ...reconcileGreenhouseDom(form, snapshot), canFill: false as const, canSubmit: false as const };
  } catch (error) {
    if (error instanceof FormInspectionError) throw error;
    throw new FormInspectionError("Hosted-page observation could not finish safely. Check local Chromium installation or inspect the posting manually.", 502);
  } finally { busy = false; }
}
