import { z } from "zod";
import { WebLeadSchema, WebSearchSchema } from "./web-job-model";
import { checkJobConstraints, defaultJobFilters, JobFiltersSchema } from "./job-constraints";

export const BoardSchema = z.object({
  provider: z.enum(["greenhouse", "lever"]),
  board: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  company: z.string().trim().min(1).max(200),
}).strict();
export const SearchPreferencesSchema = z.object({
  roles: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
  locations: z.array(z.string().trim().min(2).max(100)).max(40),
  excludedTitleTerms: z.array(z.string().trim().min(2).max(100)).max(20),
  includeRemote: z.boolean(),
  filters: JobFiltersSchema.default(defaultJobFilters),
}).strict();
export const DiscoveryConfigSchema = z.object({
  boards: z.array(BoardSchema).max(12).refine((rows) => new Set(rows.map((r) => `${r.provider}:${r.board.toLowerCase()}`)).size === rows.length, "Duplicate board"),
  preferences: SearchPreferencesSchema,
}).strict();
export const defaultDiscoveryConfig: z.infer<typeof DiscoveryConfigSchema> = {
  boards: [
    { provider: "greenhouse", board: "spaceium", company: "Spaceium" },
    { provider: "lever", board: "wealthsimple", company: "Wealthsimple" },
    { provider: "lever", board: "altaml", company: "AltaML" },
    { provider: "lever", board: "achievers", company: "Achievers" },
  ],
  preferences: {
    roles: ["software engineer", "software developer", "AI engineer", "machine learning engineer"],
    locations: ["Toronto", "GTA", "Greater Toronto Area", "Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "Burlington", "Milton", "Ajax", "Pickering", "Whitby", "Oshawa", "Newmarket", "Aurora", "Caledon", "Halton Hills", "Clarington", "Uxbridge", "Scugog", "Brock", "Georgina", "East Gwillimbury", "King", "Whitchurch-Stouffville", "Ottawa", "Kingston"],
    excludedTitleTerms: ["senior", "sr", "staff", "principal", "director", "manager", "lead"],
    includeRemote: false,
    filters: defaultJobFilters,
  },
};

const HttpUrl = z.string().url().max(2000).refine((raw) => {
  const url = new URL(raw);
  return url.protocol === "https:" && !url.username && !url.password;
});
export const DiscoveredJobSchema = z.object({
  id: z.string(), provider: BoardSchema.shape.provider, board: z.string(), externalId: z.string(),
  company: z.string().min(1).max(240), title: z.string().min(1).max(240), location: z.string().max(240),
  url: HttpUrl, description: z.string().min(1).max(180000), fingerprint: z.string().length(64),
  firstSeenAt: z.string().datetime(), lastSeenAt: z.string().datetime(), sourceUpdatedAt: z.string().nullable(),
  availability: z.enum(["open", "closed"]),
  decision: z.enum(["new", "saved", "dismissed", "approved"]),
  decisionHash: z.string().nullable(),
}).strict();
export const ApplicationTaskSchema = z.object({
  id: z.string(), candidateId: z.string(), approvedHash: z.string(), approvedAt: z.string().datetime(),
  state: z.enum(["queued", "preparing", "needs_review", "blocked", "needs_reapproval", "cancelled"]),
  jobId: z.string().nullable(), changeSetId: z.string().nullable(),
  message: z.string(), attemptId: z.string().nullable(), leaseUntil: z.string().nullable(),
  updatedAt: z.string().datetime(),
}).strict();
export const JobAssessmentSchema = z.object({
  candidateId: z.string(), fingerprint: z.string(), profileHash: z.string(), model: z.string(), assessedAt: z.string().datetime(),
  score: z.number().min(0).max(100), summary: z.string().max(2000),
  requirements: z.array(z.object({ id: z.string(), text: z.string(), priority: z.string(),
    support: z.enum(["supported", "partial", "missing"]), factIds: z.array(z.string()), reason: z.string().max(1000) })),
}).strict();
export const SourceSearchSchema = z.object({
  id: z.string(), query: z.string().max(600), finishedAt: z.string().datetime(),
  preferencesHash: z.string(), resultCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  suggestions: z.array(z.object({
    id: z.string(), source: BoardSchema, url: HttpUrl,
    status: z.enum(["verified", "unavailable"]), checkedAt: z.string().datetime(),
    jobCount: z.number().int().nonnegative(), matchingCount: z.number().int().nonnegative(),
    message: z.string().max(500),
  }).strict()).max(6),
}).strict();
export const DiscoveryStoreSchema = z.object({
  version: z.literal(1), config: DiscoveryConfigSchema,
  jobs: z.array(DiscoveredJobSchema), tasks: z.array(ApplicationTaskSchema),
  runs: z.array(z.object({
    id: z.string(), startedAt: z.string(), finishedAt: z.string(),
    sources: z.array(z.object({ provider: z.string(), board: z.string(), count: z.number(), error: z.string().nullable() })),
  })),
  decisions: z.array(z.object({ candidateId: z.string(), fingerprint: z.string(), decision: DiscoveredJobSchema.shape.decision, at: z.string().datetime() })).default([]),
  assessments: z.array(JobAssessmentSchema).default([]),
  sourceSearch: SourceSearchSchema.nullable().default(null),
  webSearch: WebSearchSchema.nullable().default(null),
  webLeads: z.array(WebLeadSchema).max(200).default([]),
}).strict();
export type Board = z.infer<typeof BoardSchema>;
export type SearchPreferences = z.infer<typeof SearchPreferencesSchema>;
export type DiscoveryConfig = z.infer<typeof DiscoveryConfigSchema>;
export type DiscoveredJob = z.infer<typeof DiscoveredJobSchema>;
export type ApplicationTask = z.infer<typeof ApplicationTaskSchema>;
export type DiscoveryStore = z.infer<typeof DiscoveryStoreSchema>;
export type JobAssessment = z.infer<typeof JobAssessmentSchema>;
export type SourceSearch = z.infer<typeof SourceSearchSchema>;

function contains(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}

/** Preference fit, not an interview probability or a claim of qualification. */
export function rankJob(job: DiscoveredJob, preferences: SearchPreferences) {
  const roles = preferences.roles.filter((term) => contains(job.title, term));
  const locations = preferences.locations.filter((term) => contains(job.location, term));
  const excluded = preferences.excludedTitleTerms.filter((term) => contains(job.title, term));
  const remote = preferences.includeRemote && contains(job.location, "remote");
  const foreignOnly = /\b(?:United States|USA|Jamaica|United Kingdom|Australia|New York|Ohio)\b/i.test(job.location) && !/\b(?:Canada|Ontario)\b/i.test(job.location);
  const locationFit = !foreignOnly && (preferences.locations.length === 0 || locations.length > 0 || remote);
  const constraints = checkJobConstraints(job, preferences.filters);
  return {
    score: excluded.length ? 0 : (roles.length ? 60 : 0) + (locationFit ? 40 : 0),
    eligible: job.availability === "open" && roles.length > 0 && locationFit && excluded.length === 0 && constraints.passes,
    constraintChecks: constraints.checks,
    needsReview: constraints.needsReview,
    reasons: [roles.length ? `Role: ${roles.join(", ")}` : "Title does not match your target roles",
      foreignOnly ? "Location explicitly outside Canada" : locations.length ? `Location: ${locations.join(", ")}` : remote ? "Remote listed; check eligible countries" : preferences.locations.length ? "Outside your location preferences" : "Any location",
      ...(excluded.length ? [`Excluded title: ${excluded.join(", ")}`] : []),
      ...constraints.checks.filter((check) => check.status === "mismatch" || check.status === "unknown").map((check) => `${check.key}: ${check.status === "mismatch" ? "outside your filters" : preferences.filters.includeUnknown ? "unknown; retained for review" : "unknown; excluded by your setting"}`)],
    caveats: ["Experience requirements and work authorization still need JD review.", "First seen is not the original posting date."],
  };
}
