import type {
  BrowserPageSnapshot,
  PolicyDecision,
  PolicyFieldTag,
  PolicySafetySignal,
} from "@resume-agent/contracts";
import { POLICY_VERSION, evaluatePolicy } from "@resume-agent/policy";

/** A candidate answer, named by the fact it comes from. The value stays with the caller. */
export interface AnswerSource {
  /** Canonical field name, matching the page's `field:<name>` target. */
  canonicalField: string;
  factId: string;
  factStatus: "pending" | "verified" | "rejected";
  sourceCount: number;
  sensitivity: "normal" | "pii" | "sensitive" | "secret";
}

export interface PlannedField {
  targetId: string;
  canonicalField: string;
  accessibleName: string;
  required: boolean;
  sensitivity: string;
  /** Set when a verified answer exists for this field. */
  factId: string | null;
  route: PolicyDecision["route"] | "no_answer";
  reasons: string[];
  isSubmitCandidate: boolean;
}

export interface FillPlan {
  snapshotId: string;
  pageFingerprint: string;
  pageGeneration: number;
  fields: PlannedField[];
  automaticFieldIds: string[];
}

/** Field tags the policy engine treats as never-automatic, read from the canonical name. */
const TAGS_BY_FIELD: Record<string, PolicyFieldTag> = {
  work_authorization: "work_authorization",
  compensation: "compensation",
  signature: "electronic_signature",
  relocation: "relocation",
  availability: "availability",
  background_check: "background_check",
  gender: "protected_attribute",
  ethnicity: "protected_attribute",
  veteran_status: "protected_attribute",
  disability: "protected_attribute",
};

function canonicalFieldOf(target: BrowserPageSnapshot["targets"][number]): string {
  const testId = target.locatorRecipes.find((recipe) => recipe.strategy === "test_id")?.value ?? "";
  const match = /^(?:field|choice|upload):(.+)$/.exec(testId);
  return match?.[1] ?? "";
}

/**
 * Decide, field by field, what may be filled automatically.
 *
 * The policy engine sees the shape of an answer — its sensitivity, provenance, confidence,
 * and how many sources back it — and never the answer itself. A field with no verified
 * fact behind it is not proposed at all: the run has nothing truthful to type, so it goes
 * to the person instead.
 */
export function planFill(input: {
  snapshot: BrowserPageSnapshot;
  answers: readonly AnswerSource[];
  safetySignals: readonly PolicySafetySignal[];
  evaluatedAt: string;
}): FillPlan {
  const answerByField = new Map(input.answers.map((answer) => [answer.canonicalField, answer]));

  const fields = input.snapshot.targets
    .filter((target) => target.kind === "field" || target.kind === "submit")
    .map((target, index): PlannedField => {
      const canonicalField = canonicalFieldOf(target);
      const answer = answerByField.get(canonicalField);
      const isSubmitCandidate = target.kind === "submit";

      const base = {
        targetId: target.id,
        canonicalField,
        accessibleName: target.accessibleName,
        required: target.required,
        sensitivity: target.sensitivity,
        isSubmitCandidate,
      };

      // A submit candidate is never part of a fill plan. Submission is a different tool
      // with a different approval, and this runner does not have it.
      if (isSubmitCandidate) {
        return { ...base, factId: null, route: "prohibited", reasons: ["final_submission_requires_scoped_approval"] };
      }

      const tag = TAGS_BY_FIELD[canonicalField];
      const verified = answer?.factStatus === "verified" ? answer : undefined;

      // A question the site marks sensitive, or that carries a protected or legal tag,
      // belongs to the person whether or not a fact could have answered it. Reporting it
      // as merely "no fact" would understate why the runner will never touch it.
      const alwaysThePersons = target.sensitivity === "sensitive" || target.sensitivity === "secret" || Boolean(tag);

      // Otherwise, no verified answer means there is nothing truthful to type. Saying
      // "needs confirmation" would imply the runner is holding a value back; it has none.
      if (!verified && !alwaysThePersons) {
        return { ...base, factId: null, route: "no_answer", reasons: ["unverified_provenance"] };
      }
      const decision = evaluatePolicy({
        decisionId: `policy-decision:fill:${input.snapshot.snapshotId}:${index}`,
        policyVersion: POLICY_VERSION,
        evaluatedAt: input.evaluatedAt,
        automationMode: "standard",
        action: {
          id: `action:fill:${target.id}`,
          tool: "browser_set_field",
          operation: "field_write",
          targetIsFinalSubmit: false,
        },
        origin: {
          targetOrigin: input.snapshot.origin,
          currentOrigin: input.snapshot.origin,
          allowedOrigins: [input.snapshot.origin],
        },
        field: {
          observationId: target.id,
          canonicalField: `candidate.${canonicalField}`,
          // The page's own marking wins over the profile's: a question the site treats as
          // sensitive stays with the person even when the fact behind it is ordinary.
          sensitivity: target.sensitivity === "normal" ? (verified?.sensitivity ?? "normal") : target.sensitivity,
          confidence: verified ? 0.95 : 0,
          provenance: verified ? "verified_fact" : "none",
          ...(verified ? { factStatus: verified.factStatus } : {}),
          sourceCount: verified?.sourceCount ?? 0,
          tags: tag ? [tag] : [],
        },
        safetySignals: [...input.safetySignals],
      });

      return { ...base, factId: verified?.factId ?? null, route: decision.route, reasons: [...decision.reasons] };
    });

  return {
    snapshotId: input.snapshot.snapshotId,
    pageFingerprint: input.snapshot.pageFingerprint,
    pageGeneration: input.snapshot.pageGeneration,
    fields,
    automaticFieldIds: fields.filter((field) => field.route === "automatic").map((field) => field.targetId),
  };
}
