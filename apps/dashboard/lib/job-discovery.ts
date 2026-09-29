import { createHash } from "node:crypto";
import { z } from "zod";
import { BoardSchema, DiscoveredJobSchema, type Board, type DiscoveredJob } from "./discovery-model";

const MAX_RESPONSE_BYTES = 10_000_000;
const ItemId = z.union([z.string().min(1).max(200), z.number().int()]).transform(String);
const GreenhouseResponse = z.object({
  jobs: z.array(z.object({ id: ItemId, title: z.string(), absolute_url: z.string(), content: z.string(),
    location: z.object({ name: z.string() }), updated_at: z.string().optional() })).max(2000),
  meta: z.object({ total: z.number().int().nonnegative() }),
});
const LeverResponse = z.array(z.object({
  id: ItemId, text: z.string(), hostedUrl: z.string(),
  categories: z.object({ location: z.string().optional(), allLocations: z.array(z.string()).optional() }),
  descriptionPlain: z.string().optional(), description: z.string().optional(),
  additionalPlain: z.string().optional(), additional: z.string().optional(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
  workplaceType: z.string().optional(),
})).max(100);

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (code.startsWith("#")) {
      const n = code.toLowerCase().startsWith("#x") ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
export function plainJobText(html: string): string {
  let text = html;
  for (let i = 0; i < 3; i++) text = decodeEntities(text);
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|section)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function readJson(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  // URLs are constructed exclusively from validated board tokens and fixed provider hosts.
  const response = await fetcher(url, { signal, redirect: "error", headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("Source response is too large.");
  if (!response.body) throw new Error("Source returned no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Source response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function normalizeDiscoveredJob(source: Board, row: { id: string; title: string; location: string; url: string; description: string; updated?: string }, now: string): DiscoveredJob {
  const identity = `${source.provider}:${source.board.toLowerCase()}:${row.id}`;
  const description = plainJobText(row.description);
  const url = new URL(row.url);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_") || key === "source") url.searchParams.delete(key);
  const content = { title: row.title, company: source.company, location: row.location, url: url.toString(), description };
  return DiscoveredJobSchema.parse({
    ...content, id: `discovered:${sha256(identity).slice(0, 32)}`, provider: source.provider,
    board: source.board.toLowerCase(), externalId: row.id, fingerprint: sha256(JSON.stringify(content)),
    firstSeenAt: now, lastSeenAt: now, sourceUpdatedAt: row.updated ?? null,
    availability: "open", decision: "new", decisionHash: null,
  });
}

/** A source is returned only after every page validates; partial results must not close jobs. */
export async function fetchBoard(input: Board, fetcher: typeof fetch = fetch, now = new Date().toISOString()): Promise<DiscoveredJob[]> {
  const source = BoardSchema.parse(input);
  const token = encodeURIComponent(source.board.toLowerCase());
  const signal = AbortSignal.timeout(30_000);
  if (source.provider === "greenhouse") {
    const data = GreenhouseResponse.parse(await readJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, fetcher, signal));
    if (data.meta.total !== data.jobs.length) throw new Error("Source returned an incomplete job list.");
    return unique(data.jobs.map((row) => normalizeDiscoveredJob(source, { id: row.id, title: row.title, location: row.location.name, url: row.absolute_url, description: row.content, ...(row.updated_at ? { updated: row.updated_at } : {}) }, now)));
  }
  const jobs: DiscoveredJob[] = [];
  for (let skip = 0; skip < 2000; skip += 100) {
    const data = LeverResponse.parse(await readJson(`https://api.lever.co/v0/postings/${token}?mode=json&limit=100&skip=${skip}`, fetcher, signal));
    jobs.push(...data.map((row) => normalizeDiscoveredJob(source, {
      id: row.id, title: row.text, location: [...new Set([row.categories.location, ...(row.categories.allLocations ?? []), row.workplaceType].filter(Boolean))].join(" · "), url: row.hostedUrl,
      description: [row.descriptionPlain ?? row.description, ...(row.lists ?? []).map((list) => `${list.text}\n${list.content}`), row.additionalPlain ?? row.additional].filter(Boolean).join("\n"),
    }, now)));
    if (data.length < 100) return unique(jobs);
  }
  throw new Error("Source exceeded the 2,000-job limit; no partial list was saved.");
}

function unique(jobs: DiscoveredJob[]): DiscoveredJob[] {
  if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new Error("Source returned duplicate IDs or repeated pages.");
  return jobs;
}
