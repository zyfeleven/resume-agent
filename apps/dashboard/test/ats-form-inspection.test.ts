import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/agent/form/route";
import { decideJob } from "../lib/application-agent";
import { inspectApplicationForm, parseGreenhouseForm } from "../lib/ats-form-inspection";
import { readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { fetchBoard, normalizeDiscoveredJob } from "../lib/job-discovery";

const NOW = "2026-09-19T12:00:00.000Z";
const source = { provider: "greenhouse" as const, board: "fixture", company: "SIMULATED ATS FIXTURE" };
const row = { id: 17, title: "Software Engineer", location: { name: "Ottawa" },
  absolute_url: "https://job-boards.greenhouse.io/fixture/jobs/17", content: "<h2>Requirements</h2><p>Python experience.</p>" };
const candidate = () => normalizeDiscoveredJob(source, { id: String(row.id), title: row.title, location: row.location.name, url: row.absolute_url, description: row.content }, NOW);
const detail = () => ({ ...row, questions: [
  { label: "First name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
  { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
  { label: "Work authorization", required: true, fields: [{ name: "question_1", type: "multi_value_single_select", values: [{ value: 0, label: "No" }, { value: 1, label: "Yes" }] }] },
], location_questions: [{ label: "Latitude", required: true, fields: [{ name: "latitude", type: "input_hidden" }] }],
  compliance: [{ label: "Veteran status", required: false, fields: [{ name: "veteran_status", type: "multi_value_single_select", values: [{ value: "decline", label: "Decline" }] }] }],
  demographic_questions: { header: "Demographic questions", description: "Voluntary disclosure", questions: [{ id: 9, label: "Identity", required: false, type: "multi_value_multi_select", answer_options: [{ id: 91, label: "Self describe", free_form: true }] }] },
  data_compliance: [{ type: "gdpr", requires_processing_consent: true, requires_retention_consent: false }],
  include_ai_disclaimer: true, ai_disclaimer: "<p>Employer uses matching tools.</p>",
});

describe("Greenhouse public form normalization", () => {
  it("accepts real API null optional sections and preserves question instructions", () => {
    const result = parseGreenhouseForm({ ...detail(), compliance: null, demographic_questions: null, location_questions: null,
      data_compliance: null, include_ai_disclaimer: null, ai_disclaimer: null,
      questions: [{ ...detail().questions[0]!, description: "<p>Enter the name on your application.</p>" }],
    }, candidate(), "task", NOW);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.description).toBe("Enter the name on your application.");
  });
  it("keeps required groups, alternatives, options and personal disclosure separate", () => {
    const result = parseGreenhouseForm(detail(), candidate(), "task:fixture", NOW);
    expect(result.requiredQuestionCount).toBe(4);
    expect(result.questions).toHaveLength(6);
    expect(result.questions[1]).toMatchObject({ label: "Resume", required: true, fields: [{ name: "resume" }, { name: "resume_text" }] });
    expect(result.questions[2]!.fields[0]!.options).toEqual([{ value: "0", label: "No", freeForm: false }, { value: "1", label: "Yes", freeForm: false }]);
    expect(result.questions[4]!.section).toBe("compliance");
    expect(result.questions[5]!.fields[0]!.options[0]!.freeForm).toBe(true);
    expect(result.notices.join(" ")).toContain("processing consent required; retention consent not required");
    expect(result.notices.join(" ")).toContain("Employer uses matching tools.");
    expect(result.canFill).toBe(false); expect(result.canSubmit).toBe(false);
    expect(JSON.stringify(result)).not.toContain("selectedValue");
  });
  it("keeps unknown controls for manual inspection and strips label HTML", () => {
    const raw = detail(); raw.questions[0]!.label = "<script>alert('bad')</script><b>First name</b>";
    raw.questions[0]!.fields[0]!.type = "unknown_custom_widget";
    const result = parseGreenhouseForm(raw, candidate(), "task", NOW);
    expect(result.questions[0]!.label).toBe("First name");
    expect(result.questions[0]!.fields[0]!.knownType).toBe(false);
    expect(result.notices.join(" ")).toContain("Unrecognized field types");
  });
  it.each(["id", "title", "location", "description", "url"])("rejects live %s drift from the approved posting", (field) => {
    const raw = detail();
    if (field === "id") raw.id = 18;
    if (field === "title") raw.title = "Other role";
    if (field === "location") raw.location = { name: "Toronto" };
    if (field === "description") raw.content = "Updated requirements";
    if (field === "url") raw.absolute_url = "https://example.com/other";
    expect(() => parseGreenhouseForm(raw, candidate(), "task", NOW)).toThrow(/no longer matches/);
  });
  it.each([{}, { questions: [] }, { questions: [{ label: "Missing required flag", fields: [] }] }])("fails closed for absent/malformed questions", (override) => {
    const raw: Record<string, unknown> = { ...detail(), ...override };
    if (!Object.keys(override).length) delete raw.questions;
    expect(() => parseGreenhouseForm(raw, candidate(), "task", NOW)).toThrow(/missing or unsupported/);
  });
  it("rejects duplicate field identities rather than merging questions", () => {
    const raw = detail(); raw.questions.push(raw.questions[0]!);
    expect(() => parseGreenhouseForm(raw, candidate(), "task", NOW)).toThrow(/duplicate/);
  });
  it("refuses a passed deadline and keeps an unparseable deadline as source text", () => {
    expect(() => parseGreenhouseForm({ ...detail(), application_deadline: "2026-01-01T00:00:00Z" }, candidate(), "task", NOW)).toThrow(/deadline has passed/);
    expect(parseGreenhouseForm({ ...detail(), application_deadline: "Until filled" }, candidate(), "task", NOW).notices).toContain("Source application deadline: Until filled");
  });
  it("fingerprints question changes without pretending the posting approval changed", () => {
    const first = parseGreenhouseForm(detail(), candidate(), "task", NOW);
    const raw = detail(); raw.questions[0]!.required = false;
    const second = parseGreenhouseForm(raw, candidate(), "task", NOW);
    expect(first.schemaHash).not.toBe(second.schemaHash);
    expect(first.postingFingerprint).toBe(second.postingFingerprint);
  });
});

describe("approved task to read-only form inspection", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "ats-form-test-")); vi.stubEnv("RESUME_AGENT_DATA_DIR", directory); });
  afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
  async function approve() {
    const job = candidate(); await updateDiscoveryStore((store) => ({ ...store, jobs: [job] }));
    return (await decideJob(job.id, job.fingerprint, "approved")).tasks[0]!;
  }
  it("uses one fixed-host GET, sends no profile/credentials, and changes no stored decisions", async () => {
    const task = await approve(); const before = await readDiscoveryStore();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(detail())));
    const result = await inspectApplicationForm(task.id, candidate().fingerprint, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(["https://boards-api.greenhouse.io/v1/boards/fixture/jobs/17?questions=true", expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store", headers: { Accept: "application/json" } })]);
    expect(result.taskId).toBe(task.id);
    expect(await readDiscoveryStore()).toEqual(before);
  });
  it.each(["saved", "closed", "changed", "missing", "cancelled", "lever", "board", "path"])("refuses %s before any remote call", async (kind) => {
    const task = await approve(); const fetcher = vi.fn();
    await updateDiscoveryStore((store) => {
      if (kind === "missing") store.tasks = [];
      if (kind === "cancelled") store.tasks[0]!.state = "cancelled";
      if (kind === "saved") store.jobs[0]!.decision = "saved";
      if (kind === "closed") store.jobs[0]!.availability = "closed";
      if (kind === "changed") store.jobs[0]!.fingerprint = "c".repeat(64);
      if (kind === "lever") store.jobs[0]!.provider = "lever";
      if (kind === "board") store.jobs[0]!.board = "../internal";
      if (kind === "path") store.jobs[0]!.externalId = "17/../../internal";
      return store;
    });
    await expect(inspectApplicationForm(task.id, candidate().fingerprint, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([404, 410, 429, 500])("handles HTTP %s without retry or state mutation", async (status) => {
    const task = await approve(); const before = await readDiscoveryStore(); const fetcher = vi.fn(async () => new Response("", { status }));
    await expect(inspectApplicationForm(task.id, candidate().fingerprint, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await readDiscoveryStore()).toEqual(before);
  });
  it.each(["length", "stream", "json", "network"])("rejects %s failures without leaking provider details", async (kind) => {
    const task = await approve();
    const fetcher = vi.fn(async () => {
      if (kind === "network") throw new Error("private upstream details");
      if (kind === "length") return new Response("{}", { headers: { "content-length": "2000001" } });
      if (kind === "stream") return new Response("x".repeat(2000001));
      return new Response("not JSON");
    });
    await expect(inspectApplicationForm(task.id, candidate().fingerprint, fetcher)).rejects.not.toThrow(/private upstream details/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent reads and discards responses arriving after cancellation", async () => {
    const task = await approve(); let release!: () => void; let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; }); const ready = new Promise<void>((resolve) => { started = resolve; });
    const run = inspectApplicationForm(task.id, candidate().fingerprint, async () => { started(); await pending; return new Response(JSON.stringify(detail())); });
    await ready;
    await expect(inspectApplicationForm(task.id, candidate().fingerprint, vi.fn())).rejects.toThrow(/already running/);
    await decideJob(candidate().id, candidate().fingerprint, "dismissed"); release();
    await expect(run).rejects.toThrow(/approve/);
  });
  it("rejects reapproval during the public request", async () => {
    const task = await approve();
    await expect(inspectApplicationForm(task.id, candidate().fingerprint, async () => {
      await updateDiscoveryStore((store) => ({ ...store, tasks: store.tasks.map((entry) => ({ ...entry, approvedAt: NOW })) }));
      return new Response(JSON.stringify(detail()));
    })).rejects.toThrow(/changed during/);
  });
  it("requires same-origin local UI and refuses destination/answer injection", async () => {
    const task = await approve(); const fetcher = vi.fn(async () => new Response(JSON.stringify(detail()))); vi.stubGlobal("fetch", fetcher);
    const request = (body: unknown, origin = "http://127.0.0.1:3000") => new Request("http://localhost:3000/api/agent/form", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const body = { taskId: task.id, fingerprint: candidate().fingerprint };
    expect((await POST(request(body, "https://evil.example"))).status).toBe(403);
    expect((await POST(request({ ...body, url: "http://127.0.0.1/secret", answers: {} }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await POST(request(body)); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ canFill: false, canSubmit: false });
  });
});

it.skipIf(process.env.RESUME_AGENT_LIVE_ATS !== "1")("opt-in public Greenhouse schema smoke (no user data or application writes)", async () => {
  const jobs = await fetchBoard({ provider: "greenhouse", board: "spaceium", company: "Spaceium" });
  expect(jobs.length).toBeGreaterThan(0);
  const job = jobs[0]!;
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/spaceium/jobs/${job.externalId}?questions=true`, { redirect: "error", signal: AbortSignal.timeout(20000) });
  expect(response.ok).toBe(true);
  const result = parseGreenhouseForm(await response.json(), job, "task:live-read-only", new Date().toISOString());
  expect(result.questions.length).toBeGreaterThan(0); expect(result.canSubmit).toBe(false);
}, 60000);
