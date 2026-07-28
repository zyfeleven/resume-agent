import {
  BrowserPageSnapshotSchema,
  type BrowserPageSnapshot,
  type DataSensitivity,
  type PolicySafetySignal,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import type { Page } from "playwright";

/** Milliseconds a snapshot stays usable for a write. */
const LEASE_MS = 5 * 60 * 1000;

interface ObservedTarget {
  testId: string;
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
const OBSERVE_SCRIPT = `(() => {
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
  return {
    title: document.title,
    fixtureId: document.documentElement.getAttribute("data-fixture-id") || "",
    fixtureRevision: document.documentElement.getAttribute("data-fixture-revision") || "",
    fixtureSignal: document.documentElement.getAttribute("data-fixture-signal") || "",
    validationMessages: [...document.querySelectorAll("[data-testid^='validation:']")]
      .map((node) => (node.textContent || "").trim())
      .filter((text) => text.length > 0),
    targets: controls.map((element) => ({
      testId: element.getAttribute("data-testid") || "",
      tag: element.tagName.toLowerCase(),
      type: (element.getAttribute("type") || "").toLowerCase(),
      name: element.getAttribute("name") || "",
      accessibleName: accessibleName(element).slice(0, 500),
      required: element.hasAttribute("required"),
      disabled: element.hasAttribute("disabled"),
      sensitiveMarker: Boolean(element.closest("[data-sensitive='true']")),
      submitCandidate: element.getAttribute("data-submit-candidate") === "true",
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

const PII_FIELDS = new Set(["first_name", "last_name", "email", "phone", "location", "full_name", "address"]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function controlTypeFor(target: ObservedTarget): string {
  if (target.tag === "textarea") return "textarea";
  if (target.tag === "select") return "select";
  if (target.tag === "button") return "button";
  return CONTROL_TYPE_BY_INPUT[target.type] ?? "text";
}

/** Sensitivity is read from the page's own marking, then from the canonical field name. */
function sensitivityFor(target: ObservedTarget): DataSensitivity {
  if (target.sensitiveMarker) {
    return "sensitive";
  }
  if (PII_FIELDS.has(target.name)) {
    return "pii";
  }
  return "normal";
}

function originOf(url: string): string {
  return new URL(url).origin;
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

  const targets = observed.targets
    .filter((target) => target.testId.length > 0 || target.name.length > 0)
    .slice(0, 2_000)
    .map((target, index) => {
      const controlType = controlTypeFor(target);
      const id = `target:${sha256(`${snapshotId}|${target.testId}|${target.name}|${index}`).slice(0, 16)}`;
      const locatorValue = target.testId.length > 0 ? target.testId : target.accessibleName || target.name;
      const base = {
        id,
        frameId,
        role: target.tag === "button" ? "button" : target.tag === "select" ? "combobox" : "textbox",
        accessibleName: target.accessibleName,
        question: target.accessibleName,
        required: target.required,
        disabled: target.disabled,
        sensitivity: sensitivityFor(target),
        options: target.optionLabels.map((label) => ({ label, value: label })),
        observedValue: {
          // Presence only. The value itself never left the page.
          state: target.hasValue ? ("present" as const) : ("empty" as const),
          selectedOptionLabels: [],
        },
        locatorRecipes: [
          {
            id: `${id}:locator`,
            sourceSnapshotId: snapshotId,
            strategy: target.testId.length > 0 ? ("test_id" as const) : ("label" as const),
            value: locatorValue,
            exact: true,
            framePath: [],
            priority: 10,
          },
        ],
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
    fixtureRevision: observed.fixtureRevision,
  };
}
