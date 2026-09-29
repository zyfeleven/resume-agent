import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/agent/route";
import { defaultDiscoveryConfig, DiscoveryConfigSchema, rankJob, type DiscoveredJob } from "../lib/discovery-model";
import { readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { checkJobConstraints, defaultJobFilters, extractJobConstraints, type JobFilters } from "../lib/job-constraints";

const job: DiscoveredJob = {
  id: "job:fixture", provider: "lever", board: "fixture", externalId: "1", company: "Fixture", title: "Software Engineer",
  location: "Ottawa, Ontario · hybrid", url: "https://jobs.lever.co/fixture/1", description: "Requirements\n2+ years of Python experience.\nAnnual base salary: CAD 80,000–100,000.",
  fingerprint: "a".repeat(64), firstSeenAt: "2026-09-18T12:00:00.000Z", lastSeenAt: "2026-09-18T12:00:00.000Z", sourceUpdatedAt: null,
  availability: "open", decision: "new", decisionHash: null,
};
const filters: JobFilters = { maxRequiredYears: 2, minAnnualCad: 90_000, workModes: ["hybrid"], includeUnknown: true };

describe("conservative posting signals", () => {
  it("keeps line citations and checks only explicit requirements and CAD annual salary", () => {
    const signals = extractJobConstraints(job);
    expect(signals.experience).toMatchObject({ value: 2, evidence: [{ line: 2, text: "2+ years of Python experience." }] });
    expect(signals.salary).toMatchObject({ value: { min: 80000, max: 100000 }, evidence: [{ line: 3 }] });
    expect(signals.workMode.value).toBe("hybrid");
    expect(checkJobConstraints(job, filters).checks.map((check) => check.status)).toEqual(["match", "match", "match"]);
  });
  it("uses the range lower bound and highest independent required experience, not preferred years", () => {
    const signals = extractJobConstraints({ ...job, description: "Requirements\n0–2 years of experience.\nMinimum 3 years of professional experience required.\nPreferred qualifications\n8 years of experience.\nBenefits\nOur company has 25 years of experience." });
    expect(signals.experience.value).toBe(3);
    expect(signals.experience.evidence).toHaveLength(2);
  });
  it.each([
    "Requirements\n3 years experience or equivalent education.",
    "Minimum 2.5 years experience required.",
    "Minimum 2,5 years experience required.",
    "Requirements\n2 years experience.\nFive years of experience required.",
    "Requirements\nAt least three years of experience.",
    "Requirements\nUp to 5 years of experience.",
    "Requirements\n5–3 years of experience.",
    "About us\nOur company has 20 years of experience.",
    "Requirements\n5 years of experience preferred.",
    "Requirements\nPython\nPreferred\n5 years of experience.",
    "No previous experience required.",
  ])("leaves ambiguous or non-required years unknown: %s", (description) => {
    expect(extractJobConstraints({ ...job, description }).experience.value).toBeNull();
  });
  it.each([
    "Annual salary: $80,000–100,000.",
    "Annual salary: USD 80,000–100,000.",
    "Salary: CAD 40–50 per hour.",
    "Salary: CAD 80,000–100,000.",
    "Annual salary: CAD 80,000–100,000 plus bonus.",
    "Annual salary: CAD 80,000–100,000 or USD 65,000–80,000.",
    "Annual salary: CAD 80,000–100,000.\nAnnual salary: CAD 120,000–160,000.",
    "Annual salary: CAD 100,000–80,000.",
    "Annual salary: up to CAD 100,000.",
    "Annual salary: CAD 80–100k.",
    "Annual salary: CAD 80k–100.",
    "Annual salary: CAD 80000.50.",
  ])("does not convert or guess unsupported salary expressions: %s", (description) => {
    expect(extractJobConstraints({ ...job, description }).salary.value).toBeNull();
  });
  it.each([
    ["Annual base salary: CAD 80k–100k", 80000, 100000],
    ["Salary: C$80,000–C$100,000 per year", 80000, 100000],
    ["Salary: $80,000–$100,000 CAD/year", 80000, 100000],
    ["Annual salary: CAD 80.5k–100.5k", 80500, 100500],
  ])("recognizes supported salary forms: %s", (description, min, max) => {
    expect(extractJobConstraints({ ...job, description }).salary.value).toEqual({ min, max });
  });
  it("does not infer work mode from perks, or pick one of conflicting location labels", () => {
    expect(extractJobConstraints({ description: "Flexible remote work options.", location: "Toronto" }).workMode.value).toBeNull();
    expect(extractJobConstraints({ ...job, location: "Toronto · remote or onsite" }).workMode.value).toBeNull();
    expect(extractJobConstraints({ ...job, location: "Ottawa · not remote" }).workMode.value).toBeNull();
    expect(extractJobConstraints({ ...job, location: "Ottawa · non-remote" }).workMode.value).toBeNull();
    expect(extractJobConstraints({ ...job, location: "Kingston · on-site" }).workMode.value).toBe("onsite");
  });
});

describe("transparent filtering", () => {
  it("does not change existing recommendations when optional filters are unset", () => {
    const { filters: ignored, ...legacy } = defaultDiscoveryConfig.preferences;
    const migrated = DiscoveryConfigSchema.parse({ ...defaultDiscoveryConfig, preferences: legacy });
    expect(migrated.preferences.filters).toEqual(defaultJobFilters);
    expect(rankJob(job, migrated.preferences).eligible).toBe(true);
    expect(rankJob(job, migrated.preferences).needsReview).toBe(false);
  });
  it("distinguishes unknown evidence from mismatches and allows an explicit unknown policy", () => {
    const unknown = { ...job, description: "Build APIs.", location: "Ottawa" };
    const kept = checkJobConstraints(unknown, filters);
    expect(kept.checks.map((check) => check.status)).toEqual(["unknown", "unknown", "unknown"]);
    expect(kept).toMatchObject({ passes: true, needsReview: true });
    expect(checkJobConstraints(unknown, { ...filters, includeUnknown: false }).passes).toBe(false);
    expect(checkJobConstraints(job, { ...filters, maxRequiredYears: 1, minAnnualCad: 120000, workModes: ["onsite"] }).checks.map((check) => check.status)).toEqual(["mismatch", "mismatch", "mismatch"]);
  });
  it("does not mistake range overlap for a guarantee or weaken geography/title checks", () => {
    const prefs = { ...defaultDiscoveryConfig.preferences, filters };
    expect(rankJob(job, prefs).eligible).toBe(true);
    expect(rankJob(job, prefs).constraintChecks[1]?.reason).toContain("not a guaranteed offer");
    expect(rankJob({ ...job, location: "Vancouver · hybrid" }, prefs).eligible).toBe(false);
    expect(rankJob({ ...job, title: "Senior Software Engineer" }, prefs).eligible).toBe(false);
    expect(rankJob(job, { ...prefs, filters: { ...filters, maxRequiredYears: 1 } }).eligible).toBe(false);
    expect(rankJob(job, { ...prefs, filters: { ...filters, maxRequiredYears: 1 } }).score).toBe(100); // Role/location score remains distinct.
  });
});

describe("saved filter API integration", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "job-filter-test-")); vi.stubEnv("RESUME_AGENT_DATA_DIR", directory); });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  const configure = (config: unknown) => POST(new Request("http://localhost:3000/api/agent", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ action: "configure", config }) }));
  it("persists filters and reranks existing jobs without external requests or altering decisions", async () => {
    await updateDiscoveryStore((store) => ({ ...store, jobs: [{ ...job, decision: "saved", decisionHash: job.fingerprint }] }));
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must stay local"));
    try {
      const response = await configure({ ...defaultDiscoveryConfig, preferences: { ...defaultDiscoveryConfig.preferences, filters: { ...filters, maxRequiredYears: 1 } } });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.jobs[0]).toMatchObject({ decision: "saved", rank: { eligible: false } });
      expect((await readDiscoveryStore()).config.preferences.filters.maxRequiredYears).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("rejects out-of-range values and does not overwrite the previous settings", async () => {
    const response = await configure({ ...defaultDiscoveryConfig, preferences: { ...defaultDiscoveryConfig.preferences, filters: { ...filters, maxRequiredYears: -1 } } });
    expect(response.status).toBe(400);
    expect((await readDiscoveryStore()).config.preferences.filters).toEqual(defaultJobFilters);
  });
});
