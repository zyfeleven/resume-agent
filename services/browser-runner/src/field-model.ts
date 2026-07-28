import type { DataSensitivity } from "@resume-agent/contracts";

/**
 * Turn one observed control into a canonical field.
 *
 * Real application forms carry no test IDs and no sensitivity markers, so meaning has to
 * be read from what the page actually offers: the autocomplete token, the input type, the
 * visible label, and the form control's own name. Every conclusion carries the evidence
 * that produced it and a confidence the policy engine can act on, because a field the
 * runner is unsure about must not be filled automatically.
 */

export type EvidenceSource = "autocomplete" | "input_type" | "label" | "control_name" | "placeholder";

export interface FieldEvidence {
  source: EvidenceSource;
  /** The token or phrase that matched, so a classification can be argued with. */
  detail: string;
  canonicalField: string;
  weight: number;
}

export interface FieldNormalization {
  canonicalField: string;
  confidence: number;
  sensitivity: DataSensitivity;
  evidence: FieldEvidence[];
  /** Set when different signals disagreed about what this field means. */
  contested: boolean;
}

export interface ObservedControl {
  accessibleName: string;
  autocomplete: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  testId: string;
}

/**
 * Fields whose sensitivity comes from what they ask, not from how a page marks them.
 *
 * A real employer's EEO question carries no attribute saying it is sensitive. Classifying
 * by meaning is what keeps those answers with the person on a site that gives no hint.
 */
const SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  "work_authorization",
  "visa_sponsorship",
  "gender",
  "ethnicity",
  "race",
  "veteran_status",
  "disability",
  "criminal_record",
  "background_check",
  "date_of_birth",
  "signature",
  "compensation",
  "salary_expectation",
  "citizenship",
  "sexual_orientation",
  "marital_status",
  "religion",
]);

const PII_FIELDS: ReadonlySet<string> = new Set([
  "first_name",
  "last_name",
  "full_name",
  "preferred_name",
  "email",
  "phone",
  "location",
  "city",
  "state",
  "country",
  "postal_code",
  "address",
  "linkedin",
  "github",
  "website",
]);

/** HTML autocomplete tokens are a standard the page author opted into, so they lead. */
const AUTOCOMPLETE_FIELDS: Record<string, string> = {
  "given-name": "first_name",
  "additional-name": "middle_name",
  "family-name": "last_name",
  name: "full_name",
  nickname: "preferred_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  url: "website",
  "street-address": "address",
  "address-line1": "address",
  "address-level1": "state",
  "address-level2": "city",
  "postal-code": "postal_code",
  "country-name": "country",
  country: "country",
  organization: "employer",
  "organization-title": "job_title",
  bday: "date_of_birth",
  sex: "gender",
};

const INPUT_TYPE_FIELDS: Record<string, string> = {
  email: "email",
  tel: "phone",
  url: "website",
};

/**
 * Phrases that identify a field by its visible question.
 *
 * Ordered longest-first at match time so a specific phrase wins over a general one: a
 * question mentioning "work authorization" must not be read as merely "authorization".
 */
const LABEL_PHRASES: ReadonlyArray<{ phrase: string; canonicalField: string }> = [
  { phrase: "first name", canonicalField: "first_name" },
  { phrase: "given name", canonicalField: "first_name" },
  { phrase: "forename", canonicalField: "first_name" },
  { phrase: "last name", canonicalField: "last_name" },
  { phrase: "family name", canonicalField: "last_name" },
  { phrase: "surname", canonicalField: "last_name" },
  { phrase: "preferred name", canonicalField: "preferred_name" },
  { phrase: "full name", canonicalField: "full_name" },
  { phrase: "email address", canonicalField: "email" },
  { phrase: "e-mail", canonicalField: "email" },
  { phrase: "email", canonicalField: "email" },
  { phrase: "phone number", canonicalField: "phone" },
  { phrase: "mobile number", canonicalField: "phone" },
  { phrase: "telephone", canonicalField: "phone" },
  { phrase: "phone", canonicalField: "phone" },
  { phrase: "linkedin", canonicalField: "linkedin" },
  { phrase: "github", canonicalField: "github" },
  { phrase: "portfolio", canonicalField: "website" },
  { phrase: "personal website", canonicalField: "website" },
  { phrase: "website", canonicalField: "website" },
  { phrase: "postal code", canonicalField: "postal_code" },
  { phrase: "zip code", canonicalField: "postal_code" },
  { phrase: "current location", canonicalField: "location" },
  { phrase: "location", canonicalField: "location" },
  { phrase: "city", canonicalField: "city" },
  { phrase: "country", canonicalField: "country" },
  { phrase: "street address", canonicalField: "address" },
  { phrase: "earliest start date", canonicalField: "start_date" },
  { phrase: "start date", canonicalField: "start_date" },
  { phrase: "available to start", canonicalField: "start_date" },
  { phrase: "notice period", canonicalField: "notice_period" },
  { phrase: "how did you hear", canonicalField: "referral_source" },
  { phrase: "referred by", canonicalField: "referral_source" },
  { phrase: "current employer", canonicalField: "employer" },
  { phrase: "current title", canonicalField: "job_title" },

  // Sensitive, legal, and protected questions.
  { phrase: "legally authorized to work", canonicalField: "work_authorization" },
  { phrase: "authorized to work", canonicalField: "work_authorization" },
  { phrase: "right to work", canonicalField: "work_authorization" },
  { phrase: "work authorization", canonicalField: "work_authorization" },
  { phrase: "work permit", canonicalField: "work_authorization" },
  { phrase: "require sponsorship", canonicalField: "visa_sponsorship" },
  { phrase: "need sponsorship", canonicalField: "visa_sponsorship" },
  { phrase: "visa sponsorship", canonicalField: "visa_sponsorship" },
  { phrase: "sponsorship", canonicalField: "visa_sponsorship" },
  { phrase: "citizenship", canonicalField: "citizenship" },
  { phrase: "expected compensation", canonicalField: "compensation" },
  { phrase: "salary expectation", canonicalField: "compensation" },
  { phrase: "desired salary", canonicalField: "compensation" },
  { phrase: "compensation", canonicalField: "compensation" },
  { phrase: "date of birth", canonicalField: "date_of_birth" },
  { phrase: "gender identity", canonicalField: "gender" },
  { phrase: "gender", canonicalField: "gender" },
  { phrase: "race or ethnicity", canonicalField: "ethnicity" },
  { phrase: "ethnicity", canonicalField: "ethnicity" },
  { phrase: "hispanic or latino", canonicalField: "ethnicity" },
  { phrase: "race", canonicalField: "race" },
  { phrase: "veteran status", canonicalField: "veteran_status" },
  { phrase: "protected veteran", canonicalField: "veteran_status" },
  { phrase: "disability", canonicalField: "disability" },
  { phrase: "criminal", canonicalField: "criminal_record" },
  { phrase: "convicted", canonicalField: "criminal_record" },
  { phrase: "background check", canonicalField: "background_check" },
  { phrase: "electronic signature", canonicalField: "signature" },
  { phrase: "signature", canonicalField: "signature" },
  { phrase: "sign your name", canonicalField: "signature" },
  { phrase: "sexual orientation", canonicalField: "sexual_orientation" },
  { phrase: "marital status", canonicalField: "marital_status" },
];

/** Attribute-name fragments, matched against a normalized `name`/`id`. */
const NAME_TOKENS: ReadonlyArray<{ token: string; canonicalField: string }> = [
  { token: "firstname", canonicalField: "first_name" },
  { token: "fname", canonicalField: "first_name" },
  { token: "givenname", canonicalField: "first_name" },
  { token: "lastname", canonicalField: "last_name" },
  { token: "lname", canonicalField: "last_name" },
  { token: "surname", canonicalField: "last_name" },
  { token: "fullname", canonicalField: "full_name" },
  { token: "email", canonicalField: "email" },
  { token: "mail", canonicalField: "email" },
  { token: "phone", canonicalField: "phone" },
  { token: "mobile", canonicalField: "phone" },
  { token: "telephone", canonicalField: "phone" },
  { token: "tel", canonicalField: "phone" },
  { token: "linkedin", canonicalField: "linkedin" },
  { token: "github", canonicalField: "github" },
  { token: "website", canonicalField: "website" },
  { token: "portfolio", canonicalField: "website" },
  { token: "location", canonicalField: "location" },
  { token: "city", canonicalField: "city" },
  { token: "country", canonicalField: "country" },
  { token: "postalcode", canonicalField: "postal_code" },
  { token: "zip", canonicalField: "postal_code" },
  { token: "startdate", canonicalField: "start_date" },
  { token: "noticeperiod", canonicalField: "notice_period" },
  { token: "workauth", canonicalField: "work_authorization" },
  { token: "authorization", canonicalField: "work_authorization" },
  { token: "sponsorship", canonicalField: "visa_sponsorship" },
  { token: "compensation", canonicalField: "compensation" },
  { token: "salary", canonicalField: "compensation" },
  { token: "gender", canonicalField: "gender" },
  { token: "ethnicity", canonicalField: "ethnicity" },
  { token: "veteran", canonicalField: "veteran_status" },
  { token: "disability", canonicalField: "disability" },
  { token: "signature", canonicalField: "signature" },
];

const WEIGHTS: Record<EvidenceSource, number> = {
  autocomplete: 0.95,
  label: 0.9,
  input_type: 0.85,
  control_name: 0.7,
  placeholder: 0.6,
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeAttribute(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The fixture convention, kept because the controlled lab still uses it. */
function fromTestId(testId: string): string | null {
  const match = /^(?:field|choice|upload):(.+)$/.exec(testId);
  return match?.[1] ?? null;
}

function matchLabel(text: string): { phrase: string; canonicalField: string } | null {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return null;
  }

  // Longest phrase first: "work authorization" must beat "authorization".
  const candidates = [...LABEL_PHRASES]
    .filter((entry) => normalized.includes(entry.phrase))
    .sort((left, right) => right.phrase.length - left.phrase.length);
  return candidates[0] ?? null;
}

function matchName(value: string): { token: string; canonicalField: string } | null {
  const normalized = normalizeAttribute(value);
  if (normalized.length === 0) {
    return null;
  }
  const candidates = [...NAME_TOKENS]
    .filter((entry) => normalized.includes(entry.token))
    .sort((left, right) => right.token.length - left.token.length);
  return candidates[0] ?? null;
}

export function sensitivityOf(canonicalField: string): DataSensitivity {
  if (SENSITIVE_FIELDS.has(canonicalField)) {
    return "sensitive";
  }
  return PII_FIELDS.has(canonicalField) ? "pii" : "normal";
}

/**
 * Classify one control.
 *
 * Agreement between independent signals raises confidence; disagreement lowers it and is
 * reported, because a contested field is exactly the kind the runner should hand over
 * rather than guess at. A control nothing recognizes is `unknown` with no confidence,
 * which the policy engine will never route to an automatic write.
 */
export function normalizeField(control: ObservedControl): FieldNormalization {
  const evidence: FieldEvidence[] = [];

  const fixtureField = fromTestId(control.testId);
  if (fixtureField) {
    evidence.push({ source: "control_name", detail: control.testId, canonicalField: fixtureField, weight: WEIGHTS.autocomplete });
  }

  const autocompleteToken = normalizeText(control.autocomplete).split(" ").pop() ?? "";
  const autocompleteField = AUTOCOMPLETE_FIELDS[autocompleteToken];
  if (autocompleteField) {
    evidence.push({ source: "autocomplete", detail: autocompleteToken, canonicalField: autocompleteField, weight: WEIGHTS.autocomplete });
  }

  const label = matchLabel(control.accessibleName);
  if (label) {
    evidence.push({ source: "label", detail: label.phrase, canonicalField: label.canonicalField, weight: WEIGHTS.label });
  }

  const typeField = INPUT_TYPE_FIELDS[control.type];
  if (typeField) {
    evidence.push({ source: "input_type", detail: control.type, canonicalField: typeField, weight: WEIGHTS.input_type });
  }

  const named = matchName(`${control.name} ${control.id}`);
  if (named) {
    evidence.push({ source: "control_name", detail: named.token, canonicalField: named.canonicalField, weight: WEIGHTS.control_name });
  }

  const placeholder = matchLabel(control.placeholder);
  if (placeholder) {
    evidence.push({
      source: "placeholder",
      detail: placeholder.phrase,
      canonicalField: placeholder.canonicalField,
      weight: WEIGHTS.placeholder,
    });
  }

  if (evidence.length === 0) {
    return { canonicalField: "unknown", confidence: 0, sensitivity: "normal", evidence: [], contested: false };
  }

  const ranked = [...evidence].sort((left, right) => right.weight - left.weight);
  const leader = ranked[0] as FieldEvidence;
  const agreeing = ranked.filter((entry) => entry.canonicalField === leader.canonicalField);
  const dissenting = ranked.filter((entry) => entry.canonicalField !== leader.canonicalField);

  // A field is contested only when the signals are genuinely split. One weaker signal
  // differing is ordinary — a LinkedIn box is still `type="url"` — and treating that as a
  // conflict would hand back fields the runner does understand. An even split is not
  // understanding, so it costs confidence and is reported.
  const contested = dissenting.length >= agreeing.length;
  let confidence = leader.weight + 0.02 * (agreeing.length - 1);
  if (contested) {
    confidence = Math.min(confidence, 0.65) - 0.05 * (dissenting.length - 1);
  }

  const canonicalField = leader.canonicalField;
  const sensitivity = sensitivityOf(canonicalField);

  return {
    canonicalField,
    confidence: Math.max(0, Math.min(0.95, Number(confidence.toFixed(2)))),
    sensitivity,
    evidence: ranked,
    contested,
  };
}
