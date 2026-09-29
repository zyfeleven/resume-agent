import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideJob, discoverJobs, mergeDiscovery, prepareApplication } from "../lib/application-agent";
import { emptyDiscoveryStore, readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { fetchBoard } from "../lib/job-discovery";
import { GeminiResumeError } from "../lib/gemini-resume-provider";
import { importDiscoveredJob } from "../lib/prepare-agent-resume";
import { readJobStore } from "../lib/job-store";
import { POST } from "../app/api/agent/route";

const SOURCE = { provider: "greenhouse" as const, board: "example", company: "Example" };
const row = { id: 17, title: "Software Engineer", absolute_url: "https://job-boards.greenhouse.io/example/jobs/17", location: { name: "Ottawa, Ontario" }, content: "<h2>Requirements</h2><p>Python and SQL experience.</p>" };
const feed = () => new Response(JSON.stringify({ jobs: [row], meta: { total: 1 } }));
const getCandidate = async () => (await fetchBoard(SOURCE, vi.fn(async () => feed())))[0]!;

describe("durable application preparation", () => {
  let temp: string;
  const oldDirectory = process.env.RESUME_AGENT_DATA_DIR;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "job-agent-test-"));
    process.env.RESUME_AGENT_DATA_DIR = temp;
  });
  afterEach(async () => {
    if (oldDirectory === undefined) delete process.env.RESUME_AGENT_DATA_DIR; else process.env.RESUME_AGENT_DATA_DIR = oldDirectory;
    await rm(temp, { recursive: true, force: true });
  });
  async function approve() {
    const job = await getCandidate();
    await updateDiscoveryStore((store) => ({ ...store, jobs: [job] }));
    const store = await decideJob(job.id, job.fingerprint, "approved");
    return { job, task: store.tasks[0]! };
  }
  it("keeps a single posting and task across repeated searches and approvals", async () => {
    const { job } = await approve();
    await decideJob(job.id, job.fingerprint, "approved");
    const current = await readDiscoveryStore();
    const merged = mergeDiscovery(current, [{ source: SOURCE, jobs: [job], error: null }]);
    expect(merged.jobs).toHaveLength(1);
    expect(merged.tasks).toHaveLength(1);
    expect(merged.jobs[0]?.decision).toBe("approved");
    expect(merged.decisions).toHaveLength(2);
  });
  it("invalidates an approval when content changes or the posting closes, not on source failures", async () => {
    const { job } = await approve();
    const current = await readDiscoveryStore();
    expect(mergeDiscovery(current, [{ source: SOURCE, jobs: [], error: "offline" }]).tasks[0]?.state).toBe("queued");
    const changed = mergeDiscovery(current, [{ source: SOURCE, jobs: [{ ...job, fingerprint: "b".repeat(64) }], error: null }]);
    expect(changed.tasks[0]?.state).toBe("needs_reapproval");
    expect(changed.jobs[0]?.decision).toBe("new");
    const closed = mergeDiscovery(current, [{ source: SOURCE, jobs: [], error: null }]);
    expect(closed.jobs[0]?.availability).toBe("closed");
    expect(closed.tasks[0]?.state).toBe("needs_reapproval");
    await updateDiscoveryStore(() => changed);
    await expect(decideJob(job.id, job.fingerprint, "approved")).rejects.toThrow(/changed/);
  });
  it("requires approval and never turns a prepared resume into submission authority", async () => {
    const { job, task } = await approve();
    const deps = { importJob: vi.fn(async () => "job:17"), generate: vi.fn(async () => ({ changeSetId: "change:17", passed: true })) };
    await decideJob(job.id, job.fingerprint, "saved");
    await expect(prepareApplication(task.id, deps)).rejects.toThrow(/approve/);
    expect(deps.generate).not.toHaveBeenCalled();
    await decideJob(job.id, job.fingerprint, "approved");
    const result = await prepareApplication(task.id, deps);
    expect(result.tasks[0]).toMatchObject({ state: "needs_review", changeSetId: "change:17", jobId: "job:17" });
    await prepareApplication(task.id, deps);
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it("retains a recoverable blocked task when Gemini is not configured", async () => {
    const { task } = await approve();
    const result = await prepareApplication(task.id, { importJob: async () => "job:17", generate: async () => { throw new GeminiResumeError("GEMINI_NOT_CONFIGURED", "Add a server-side Gemini key."); } });
    expect(result.tasks[0]).toMatchObject({ state: "blocked", jobId: "job:17", attemptId: null });
    expect(result.tasks[0]?.message).toContain("Gemini key");
  });
  it("excludes simultaneous preparations and ignores results arriving after cancellation", async () => {
    const { job, task } = await approve();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = { importJob: async () => "job:17", generate: async () => { started(); await gate; return { changeSetId: "change:17", passed: true }; } };
    const run = prepareApplication(task.id, deps);
    await ready;
    await expect(prepareApplication(task.id, deps)).rejects.toThrow(/already running/);
    await decideJob(job.id, job.fingerprint, "dismissed");
    release();
    expect((await run).tasks[0]?.state).toBe("cancelled");
  });
  it("resumes an expired lease after a restart and keeps claim failures blocked", async () => {
    const { task } = await approve();
    await updateDiscoveryStore((store) => ({ ...store, tasks: store.tasks.map((t) => ({ ...t, state: "preparing", attemptId: "crashed", leaseUntil: "2026-01-01T00:00:00.000Z" })) }));
    const result = await prepareApplication(task.id, { importJob: async () => "job:17", generate: async () => ({ changeSetId: "change:bad", passed: false }) });
    expect(result.tasks[0]?.state).toBe("blocked");
    expect(result.tasks[0]?.message).toMatch(/claim check failed/);
  });
  it("imports a real JD snapshot once and preserves manually reviewed requirements on retry", async () => {
    const job = await getCandidate();
    const first = await importDiscoveredJob(job);
    expect(await importDiscoveredJob(job)).toBe(first);
    const stored = await readJobStore();
    expect(stored.jobs).toHaveLength(1);
    expect(stored.requirements.length).toBeGreaterThan(0);
    expect(stored.jobs[0]?.sourceUrl).toBe(job.url);
  });
  it("persists partial source failures without closing known jobs", async () => {
    const job = await getCandidate();
    await updateDiscoveryStore(() => ({ ...emptyDiscoveryStore(), config: { ...emptyDiscoveryStore().config, boards: [SOURCE] }, jobs: [job] }));
    const result = await discoverJobs(vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect(result.jobs[0]?.availability).toBe("open");
    expect(result.runs[0]?.sources[0]?.error).toBeTruthy();
  });
  it("refuses cross-site mutations and unsupported commands", async () => {
    const make = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/agent", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await POST(make({ action: "submit" }))).status).toBe(400);
    expect((await POST(make({ action: "search" }, { origin: "https://example.org" }))).status).toBe(403);
    const localProxyRequest = new Request("http://localhost:3000/api/agent", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify({ action: "configure", config: emptyDiscoveryStore().config }) });
    expect((await POST(localProxyRequest)).status).toBe(200);
  });
});
