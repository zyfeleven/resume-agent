import {
  BrowserPageSnapshotSchema,
  type BrowserPageSnapshot,
  type DataSensitivity,
  type PolicySafetySignal,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { normalizeField, type FieldNormalization } from "./field-model.js";
import type { Page } from "playwright";

/** Milliseconds a snapshot stays usable for a write. */
const LEASE_MS = 5 * 60 * 1000;

interface ObservedTarget {
  /** SHA-256 of the control's value, computed in the page. Empty when it holds none. */
  valueHash: string;
  testId: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  tag: string;
  type: string;
  name: string;
  accessibleName: string;
  required: boolean;
  disabled: boolean;
  sensitiveMarker: boolean;
  submitCandidate: boolean;
  hasValue: boolean;
  optionLabels: string[];
}

interface ObservedPage {
  title: string;
  fixtureId: string;
  fixtureRevision: string;
  fixtureSignal: string;
  validationMessages: string[];
  targets: ObservedTarget[];
}

/**
 * The page script is fixed and owned by this runner. No caller input reaches it, and it
 * deliberately returns no field values — only whether a control holds one — so a raw
 * answer never crosses out of the page in the first place.
 */
const OBSERVE_SCRIPT = `(async () => {
  // SHA-256 of a control's value, computed in the page. The digest can leave; the value
  // it was computed from cannot, so a written answer is verifiable without being read.
  const digest = async (text) => {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const accessibleName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const target = document.getElementById(labelledBy);
      if (target) return target.textContent.trim();
    }
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (element.id) {
      const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (label) return label.textContent.replace(/\\*/g, "").trim();
    }
    const wrapping = element.closest("label");
    if (wrapping) return wrapping.textContent.replace(/\\*/g, "").trim();
    return (element.textContent || "").trim();
  };

  const controls = [...document.querySelectorAll("input, select, textarea, button")];
  const valueHashes = await Promise.all(
    controls.map(async (element) => {
      const value = typeof element.value === "string" ? element.value.trim() : "";
      return value.length > 0 ? await digest(value) : "";
    }),
  );
  return {
    title: document.title,
    fixtureId: document.documentElement.getAttribute("data-fixture-id") || "",
    fixtureRevision: document.documentElement.getAttribute("data-fixture-revision") || "",
    fixtureSignal: document.documentElement.getAttribute("data-fixture-signal") || "",
    validationMessages: [...document.querySelectorAll("[data-testid^='validation:']")]
      .map((node) => (node.textContent || "").trim())
      .filter((text) => text.length > 0),
    targets: controls.map((element, index) => ({
      valueHash: valueHashes[index],
      testId: element.getAttribute("data-testid") || "",
      tag: element.tagName.toLowerCase(),
      type: (element.getAttribute("type") || "").toLowerCase(),
      name: element.getAttribute("name") || "",
      id: element.getAttribute("id") || "",
      autocomplete: element.getAttribute("autocomplete") || "",
      placeholder: element.getAttribute("placeholder") || "",
      accessibleName: accessibleName(element).slice(0, 500),
      required: element.hasAttribute("required"),
      disabled: element.hasAttribute("disabled"),
      sensitiveMarker: Boolean(element.closest("[data-sensitive='true']")),
      // The DOM property, not the attribute: a bare <button> inside a form is a submit
      // button, and a real page marks nothing. Missing this would let a submit control be
      // treated as an ordinary one.
      submitCandidate:
        element.getAttribute("data-submit-candidate") === "true" ||
        element.type === "submit" ||
        element.type === "image",
      hasValue: typeof element.value === "string" ? element.value.length > 0 : false,
      optionLabels: element.tagName.toLowerCase() === "select"
        ? [...element.options].map((option) => option.label || option.text).slice(0, 100)
        : [],
    })),
  };
})()`;

const CONTROL_TYPE_BY_INPUT: Record<string, string> = {
  text: "text",
  email: "email",
  tel: "phone",
  number: "number",
  date: "date",
  checkbox: "checkbox",
  radio: "radio",
  file: "file",
};


function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function controlTypeFor(target: ObservedTarget): string {
  if (target.tag === "textarea") return "textarea";
  if (target.tag === "select") return "select";
  if (target.tag === "button") return "button";
  return CONTROL_TYPE_BY_INPUT[target.type] ?? "text";
}

/**
 * Sensitivity is the stricter of what the page marks and what the field means.
 *
 * A real employer's EEO or work-authorization question carries no attribute saying it is
 * sensitive, so reading meaning is what keeps those answers with the person on a site
 * that gives no hint. A page that does mark a field can only raise the classification.
 */
function sensitivityFor(target: ObservedTarget, normalization: FieldNormalization): DataSensitivity {
  if (target.sensitiveMarker || normalization.sensitivity === "sensitive") {
    return "sensitive";
  }
  return normalization.sensitivity;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * Every way this runner knows to find one control, in the order it should try them.
 *
 * Each recipe is bound to the snapshot it was produced from. A write resolves them in
 * priority order and takes the first that still matches exactly one control, so a page
 * that dropped its test IDs or renamed a field is recovered from rather than guessed at.
 */
function locatorRecipesFor(target: ObservedTarget, id: string, snapshotId: string) {
  const recipes: Array<{
    id: string;
    sourceSnapshotId: string;
    strategy: "test_id" | "label" | "name" | "placeholder";
    value: string;
    exact: boolean;
    framePath: string[];
    priority: number;
  }> = [];

  const add = (strategy: "test_id" | "label" | "name" | "placeholder", value: string, priority: number) => {
    if (value.trim().length > 0) {
      recipes.push({
        id: `${id}:locator:${strategy}`,
        sourceSnapshotId: snapshotId,
        strategy,
        value: value.trim(),
        exact: strategy !== "label",
        framePath: [],
        priority,
      });
    }
  };

  add("test_id", target.testId, 10);
  add("label", target.accessibleName, 20);
  add("name", target.name, 30);
  add("placeholder", target.placeholder, 40);

  return recipes;
}

export interface SnapshotContext {
  applicationId: string;
  runId: string;
  browserSessionRef: string;
  pageGeneration: number;
  observedAt: string;
}

export interface SnapshotResult {
  snapshot: BrowserPageSnapshot;
  /** Synthetic conditions the page declares, handed to the policy engine as-is. */
  safetySignals: PolicySafetySignal[];
  /** What each observed control was understood to mean, keyed by target id. */
  normalizations: Record<string, FieldNormalization>;
  fixtureRevision: string;
}

const KNOWN_SIGNALS = new Set<PolicySafetySignal>([
  "login_required",
  "mfa_required",
  "captcha_present",
  "unfamiliar_widget",
  "untrusted_page_instruction",
  "security_bypass_requested",
  "unexpected_download",
]);

/**
 * Observe the current page as an accessibility-first, redacted snapshot.
 *
 * The result carries structure — roles, names, questions, requiredness, options — and
 * never a field value. Locator recipes are produced here and bound to this snapshot, so a
 * later write refers to a target this runner resolved rather than to caller-supplied
 * selectors.
 */
export async function observePage(page: Page, context: SnapshotContext): Promise<SnapshotResult> {
  const observed = (await page.evaluate(OBSERVE_SCRIPT)) as ObservedPage;
  const url = page.url();

  const fingerprintSource = JSON.stringify([
    url,
    observed.fixtureId,
    observed.fixtureRevision,
    observed.targets.map((target) => [target.testId, target.tag, target.type, target.name, target.required]),
  ]);
  const pageFingerprint = sha256(fingerprintSource);
  const snapshotId = `snapshot:${pageFingerprint.slice(0, 16)}:${context.pageGeneration}`;
  const frameId = "frame:main";
  const normalizations: Record<string, FieldNormalization> = {};

  const targets = observed.targets
    // A control is worth reporting if anything can identify it. A real submit button
    // often carries no name at all, and dropping it would hide the one control that must
    // never be treated as ordinary.
    .filter(
      (target) =>
        target.submitCandidate ||
        target.testId.length > 0 ||
        target.name.length > 0 ||
        target.accessibleName.length > 0,
    )
    .slice(0, 2_000)
    .map((target, index) => {
      const controlType = controlTypeFor(target);
      const id = `target:${sha256(`${snapshotId}|${target.testId}|${target.name}|${index}`).slice(0, 16)}`;
      const normalization = normalizeField(target);
      normalizations[id] = normalization;
      const base = {
        id,
        frameId,
        role: target.tag === "button" ? "button" : target.tag === "select" ? "combobox" : "textbox",
        accessibleName: target.accessibleName,
        question: target.accessibleName,
        required: target.required,
        disabled: target.disabled,
        sensitivity: sensitivityFor(target, normalization),
        options: target.optionLabels.map((label) => ({ label, value: label })),
        observedValue: {
          // Presence and a digest. The value itself never left the page.
          state: target.hasValue ? ("present" as const) : ("empty" as const),
          ...(target.hasValue && target.valueHash ? { normalizedValueHash: target.valueHash } : {}),
          selectedOptionLabels: [],
        },
        // Several ways to find the same control, best first. A real page offers no test
        // IDs, so a write falls back through label, control name, and placeholder — and
        // uses whichever still resolves to exactly one control at write time.
        locatorRecipes: locatorRecipesFor(target, id, snapshotId),
      };

      if (target.submitCandidate) {
        return { ...base, kind: "submit" as const, controlType: "button" as const, isSubmitCandidate: true as const };
      }
      if (controlType === "button") {
        return {
          ...base,
          kind: "control" as const,
          controlType: "button" as const,
          controlIntent: "expand" as const,
          isSubmitCandidate: false as const,
        };
      }
      if (controlType === "file") {
        return { ...base, kind: "file" as const, controlType: "file" as const, isSubmitCandidate: false as const };
      }
      return { ...base, kind: "field" as const, controlType, isSubmitCandidate: false as const };
    });

  const snapshot = BrowserPageSnapshotSchema.parse({
    snapshotId,
    applicationId: context.applicationId,
    runId: context.runId,
    browserSessionRef: context.browserSessionRef,
    pageGeneration: context.pageGeneration,
    url,
    origin: originOf(url),
    title: observed.title,
    pageFingerprint,
    frames: [{ id: frameId, url, origin: originOf(url), title: observed.title }],
    targets,
    validationMessages: observed.validationMessages,
    snapshotArtifactId: `artifact:${pageFingerprint.slice(0, 24)}`,
    observedAt: context.observedAt,
    leaseExpiresAt: new Date(Date.parse(context.observedAt) + LEASE_MS).toISOString(),
  });

  const signal = observed.fixtureSignal as PolicySafetySignal;
  return {
    snapshot,
    safetySignals: KNOWN_SIGNALS.has(signal) ? [signal] : [],
    normalizations,
    fixtureRevision: observed.fixtureRevision,
  };
}
