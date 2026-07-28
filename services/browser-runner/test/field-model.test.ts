import { describe, expect, it } from "vitest";

import { normalizeField, sensitivityOf, type ObservedControl } from "../src/field-model.js";

function control(overrides: Partial<ObservedControl> = {}): ObservedControl {
  return {
    accessibleName: "",
    autocomplete: "",
    type: "text",
    name: "",
    id: "",
    placeholder: "",
    testId: "",
    ...overrides,
  };
}

describe("normalizeField", () => {
  it("reads the autocomplete token a page opted into", () => {
    expect(normalizeField(control({ autocomplete: "given-name" })).canonicalField).toBe("first_name");
    expect(normalizeField(control({ autocomplete: "family-name" })).canonicalField).toBe("last_name");
    expect(normalizeField(control({ autocomplete: "address-level2" })).canonicalField).toBe("city");
    expect(normalizeField(control({ autocomplete: "shipping email" })).canonicalField).toBe("email");
  });

  it("reads a visible label when nothing else is offered", () => {
    expect(normalizeField(control({ accessibleName: "Email address" })).canonicalField).toBe("email");
    expect(normalizeField(control({ accessibleName: "Phone number" })).canonicalField).toBe("phone");
    expect(normalizeField(control({ accessibleName: "Earliest start date" })).canonicalField).toBe("start_date");
    expect(normalizeField(control({ accessibleName: "How did you hear about this role?" })).canonicalField).toBe(
      "referral_source",
    );
  });

  it("prefers the more specific phrase when several could match", () => {
    // "work authorization" must beat the bare word "authorization".
    expect(normalizeField(control({ accessibleName: "Work authorization status" })).canonicalField).toBe(
      "work_authorization",
    );
    expect(normalizeField(control({ accessibleName: "Are you legally authorized to work here?" })).canonicalField).toBe(
      "work_authorization",
    );
    expect(normalizeField(control({ accessibleName: "Race or ethnicity" })).canonicalField).toBe("ethnicity");
  });

  it("falls back to the control's own name", () => {
    expect(normalizeField(control({ name: "candidate[email]" })).canonicalField).toBe("email");
    expect(normalizeField(control({ name: "job_application[first_name]" })).canonicalField).toBe("first_name");
    expect(normalizeField(control({ id: "c_lname" })).canonicalField).toBe("last_name");
  });

  it("classifies a question as sensitive by what it asks, not by any marker", () => {
    // Nothing on these controls announces sensitivity. Meaning is the only signal.
    expect(normalizeField(control({ accessibleName: "Gender identity (optional)" })).sensitivity).toBe("sensitive");
    expect(normalizeField(control({ accessibleName: "Protected veteran status" })).sensitivity).toBe("sensitive");
    expect(normalizeField(control({ accessibleName: "Disability status" })).sensitivity).toBe("sensitive");
    expect(normalizeField(control({ accessibleName: "Expected compensation" })).sensitivity).toBe("sensitive");
    expect(normalizeField(control({ name: "eeoc[work_auth]" })).sensitivity).toBe("sensitive");
    expect(normalizeField(control({ accessibleName: "Type your full name as an electronic signature" })).sensitivity).toBe(
      "sensitive",
    );
  });

  it("treats ordinary contact details as personal but not sensitive", () => {
    expect(normalizeField(control({ autocomplete: "email" })).sensitivity).toBe("pii");
    expect(sensitivityOf("start_date")).toBe("normal");
    expect(sensitivityOf("referral_source")).toBe("normal");
  });

  it("raises confidence when independent signals agree", () => {
    const agreeing = normalizeField(
      control({ accessibleName: "Email address", autocomplete: "email", type: "email", name: "candidate[email]" }),
    );

    expect(agreeing.canonicalField).toBe("email");
    expect(agreeing.contested).toBe(false);
    expect(agreeing.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("lowers confidence and reports a field whose signals disagree", () => {
    // The label says one thing and the control name says another.
    const contested = normalizeField(control({ accessibleName: "Email address", name: "candidate[phone_number]" }));

    expect(contested.contested).toBe(true);
    expect(contested.confidence).toBeLessThan(0.7);
    expect(contested.evidence.map((entry) => entry.canonicalField)).toContain("phone");
  });

  it("returns no confidence for a control it does not recognize", () => {
    const unknown = normalizeField(control({ accessibleName: "Favourite sandwich", name: "misc[q7]" }));

    expect(unknown.canonicalField).toBe("unknown");
    expect(unknown.confidence).toBe(0);
    expect(unknown.evidence).toEqual([]);
  });

  it("carries the evidence behind every conclusion", () => {
    const normalized = normalizeField(control({ accessibleName: "Phone number", autocomplete: "tel" }));

    expect(normalized.evidence.map((entry) => entry.source)).toEqual(["autocomplete", "label"]);
    expect(normalized.evidence[0]?.detail).toBe("tel");
  });
});
