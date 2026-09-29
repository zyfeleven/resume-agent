import { randomUUID } from "node:crypto";
import { DiscoveryConfigSchema, rankJob, type ApplicationTask, type Board, type DiscoveredJob, type DiscoveryStore } from "./discovery-model";
import { readDiscoveryStore, updateDiscoveryStore } from "./discovery-store";
import { fetchBoard } from "./job-discovery";
import { generateGeminiResume, importDiscoveredJob, ResumePreparationError } from "./prepare-agent-resume";
import { geminiConfiguration } from "./gemini-form-provider";
import { GeminiResumeError } from "./gemini-resume-provider";
import { ResumeIntelligenceError } from "./resume-intelligence";
import { ResumeTailorError } from "@resume-agent/resume-tailor";
import { assessmentProfileHash } from "./job-assessment";
import { readProfileStore } from "./profile-store";
import { sourceSearchConfiguration } from "./job-source-search";

export class AgentError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export type BoardResult = { source: Board; jobs: DiscoveredJob[]; error: string | null };

/** Merge only complete successful feeds. Failures leave availability and decisions untouched. */
export function mergeDiscovery(current: DiscoveryStore, results: BoardResult[]): DiscoveryStore {
  const jobs = new Map(current.jobs.map((job) => [job.id, { ...job }]));
  for (const result of results) {
    if (result.error) continue;
    const ids = new Set(result.jobs.map((job) => job.id));
    for (const job of jobs.values()) {
      if (job.provider === result.source.provider && job.board === result.source.board.toLowerCase() && !ids.has(job.id)) {
        job.availability = "closed";
        if (job.decision === "approved") { job.decision = "new"; job.decisionHash = null; }
      }
    }
    for (const job of result.jobs) {
      const previous = jobs.get(job.id);
      const same = previous?.fingerprint === job.fingerprint && previous.availability === "open";
      jobs.set(job.id, { ...job, firstSeenAt: previous?.firstSeenAt ?? job.firstSeenAt,
        decision: same ? previous.decision : "new", decisionHash: same ? previous.decisionHash : null });
    }
  }
  const tasks = current.tasks.map((task) => {
    const job = jobs.get(task.candidateId);
    if (task.state === "cancelled") return task;
    if (!job || job.availability !== "open" || task.approvedHash !== job.fingerprint || job.decision !== "approved") {
      return { ...task, state: "needs_reapproval" as const, attemptId: null, leaseUntil: null,
        message: "This posting changed or closed. Review it again before continuing." };
    }
    return task;
  });
  return { ...current, jobs: [...jobs.values()], tasks };
}

let searchInFlight: Promise<DiscoveryStore> | undefined;
export function discoverJobs(fetcher: typeof fetch = fetch): Promise<DiscoveryStore> {
  if (searchInFlight) return searchInFlight;
  searchInFlight = performDiscovery(fetcher).finally(() => { searchInFlight = undefined; });
  return searchInFlight;
}
async function performDiscovery(fetcher: typeof fetch) {
  const initial = await readDiscoveryStore();
  if (!initial.config.boards.length) throw new AgentError("Add at least one company job board first.", 400);
  const startedAt = new Date().toISOString();
  const results: BoardResult[] = [];
  for (let offset = 0; offset < initial.config.boards.length; offset += 3) {
    results.push(...await Promise.all(initial.config.boards.slice(offset, offset + 3).map(async (source) => {
      try { return { source, jobs: await fetchBoard(source, fetcher), error: null }; }
      catch { return { source, jobs: [], error: "Could not read a complete job list. Check the board token or try again later." }; }
    })));
  }
  return updateDiscoveryStore((current) => {
    if (JSON.stringify(current.config) !== JSON.stringify(initial.config)) throw new AgentError("Search settings changed. Run the search again.");
    const merged = mergeDiscovery(current, results);
    return { ...merged, runs: [...merged.runs, { id: randomUUID(), startedAt, finishedAt: new Date().toISOString(),
      sources: results.map((r) => ({ provider: r.source.provider, board: r.source.board, count: r.jobs.length, error: r.error })) }].slice(-30) };
  });
}
export async function saveDiscoveryConfig(value: unknown) {
  const config = DiscoveryConfigSchema.parse(value);
  return updateDiscoveryStore((current) => ({ ...current, config }));
}

export async function decideJob(id: string, fingerprint: string, decision: DiscoveredJob["decision"]) {
  return updateDiscoveryStore((current) => {
    const job = current.jobs.find((entry) => entry.id === id);
    if (!job) throw new AgentError("Job not found.", 404);
    if (job.fingerprint !== fingerprint) throw new AgentError("The posting changed. Refresh and review the latest description.");
    if (decision === "approved" && job.availability !== "open") throw new AgentError("This job is closed.");
    const now = new Date().toISOString();
    let tasks = current.tasks;
    const old = tasks.find((task) => task.candidateId === id);
    if (decision === "approved" && !(old && old.approvedHash === fingerprint && !["cancelled", "needs_reapproval"].includes(old.state))) {
      const task: ApplicationTask = { id: `application:${id}`, candidateId: id, approvedHash: fingerprint, approvedAt: now,
        state: "queued", jobId: null, changeSetId: null, message: "Approved for preparation. Resume generation is next.",
        attemptId: null, leaseUntil: null, updatedAt: now };
      tasks = [...tasks.filter((entry) => entry.candidateId !== id), task];
    } else if (decision !== "approved" && old) {
      tasks = tasks.map((task) => task.candidateId === id ? { ...task, state: "cancelled", attemptId: null, leaseUntil: null, updatedAt: now, message: "Preparation cancelled by your decision." } : task);
    }
    return { ...current, tasks, decisions: [...current.decisions, { candidateId: id, fingerprint, decision, at: now }], jobs: current.jobs.map((entry) => entry.id === id ? { ...entry, decision, decisionHash: fingerprint } : entry) };
  });
}

type PrepareDependencies = {
  importJob: typeof importDiscoveredJob;
  generate: (jobId: string) => Promise<{ changeSetId: string; passed: boolean }>;
};
const defaultPrepare: PrepareDependencies = {
  importJob: importDiscoveredJob,
  generate: async (jobId) => {
    const result = await generateGeminiResume(jobId);
    return { changeSetId: result.intelligence.changeSet.id, passed: result.guard.passed && result.semanticGuard.passed };
  },
};
export async function prepareApplication(id: string, deps: PrepareDependencies = defaultPrepare) {
  const attemptId = randomUUID();
  let candidate: DiscoveredJob | undefined;
  await updateDiscoveryStore((current) => {
    const task = current.tasks.find((entry) => entry.id === id);
    if (!task) throw new AgentError("Application task not found.", 404);
    candidate = current.jobs.find((entry) => entry.id === task.candidateId);
    if (!candidate || candidate.availability !== "open" || candidate.decision !== "approved" || candidate.fingerprint !== task.approvedHash
      || ["needs_reapproval", "cancelled"].includes(task.state)) throw new AgentError("Review and approve the current posting first.");
    if (task.state === "needs_review") return current; // Retrying must not erase sentence decisions.
    if (task.state === "preparing" && Date.parse(task.leaseUntil ?? "") > Date.now()) throw new AgentError("Preparation is already running.");
    return { ...current, tasks: current.tasks.map((entry) => entry.id === id ? { ...entry, state: "preparing", attemptId,
      leaseUntil: new Date(Date.now() + 5 * 60_000).toISOString(), updatedAt: new Date().toISOString(), message: "Importing the job and preparing your resume." } : entry) };
  });
  let snapshot = await readDiscoveryStore();
  if (snapshot.tasks.find((entry) => entry.id === id)?.attemptId !== attemptId) return snapshot;
  try {
    const jobId = await deps.importJob(candidate!);
    await updateDiscoveryStore((current) => ({ ...current, tasks: current.tasks.map((entry) => entry.id === id && entry.attemptId === attemptId ? { ...entry, jobId } : entry) }));
    snapshot = await readDiscoveryStore();
    if (snapshot.tasks.find((entry) => entry.id === id)?.attemptId !== attemptId) return snapshot;
    const result = await deps.generate(jobId);
    return updateDiscoveryStore((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id && task.attemptId === attemptId ? {
      ...task, state: result.passed ? "needs_review" : "blocked", changeSetId: result.changeSetId,
      attemptId: null, leaseUntil: null, updatedAt: new Date().toISOString(),
      message: result.passed ? "Resume proposals are ready. Review the sentences in Resume Studio." : "A claim check failed. Review the report before continuing.",
    } : task) }));
  } catch (error) {
    const message = error instanceof GeminiResumeError || error instanceof ResumeTailorError || error instanceof ResumeIntelligenceError || error instanceof ResumePreparationError
      ? error.message : "Preparation failed. Check your verified profile and parsed job requirements, then retry.";
    return updateDiscoveryStore((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id && task.attemptId === attemptId ? {
      ...task, state: "blocked", message, attemptId: null, leaseUntil: null, updatedAt: new Date().toISOString(),
    } : task) }));
  }
}

export async function discoveryPayload(store: DiscoveryStore) {
  const profileHash = assessmentProfileHash(await readProfileStore());
  return { ...store, intelligence: geminiConfiguration(), sourceSearchProvider: sourceSearchConfiguration(),
    assessments: store.assessments.map((assessment) => ({ ...assessment, stale: assessment.profileHash !== profileHash || !store.jobs.some((job) => job.id === assessment.candidateId && job.fingerprint === assessment.fingerprint && job.availability === "open") })),
    jobs: store.jobs.map((job) => ({ ...job, rank: rankJob(job, store.config.preferences) }))
      .sort((a, b) => Number(b.rank.eligible) - Number(a.rank.eligible) || b.rank.score - a.rank.score || b.firstSeenAt.localeCompare(a.firstSeenAt)),
  };
}
export type DiscoveryPayload = Awaited<ReturnType<typeof discoveryPayload>>;
