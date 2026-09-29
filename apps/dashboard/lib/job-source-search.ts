import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BoardSchema, rankJob, type Board, type SourceSearch } from "./discovery-model";
import { readDiscoveryStore, updateDiscoveryStore } from "./discovery-store";
import { fetchBoard, sha256 } from "./job-discovery";

const SITES = "(site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:boards.greenhouse.io)";
export const SourceQuerySchema = z.string().trim().min(3).max(400)
  .refine((text) => text.split(/\s+/).length <= 55, "Use at most 55 search words.");
export class SourceSearchError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
export function sourceSearchConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  const hasKey = Boolean(env.BRAVE_SEARCH_API_KEY?.trim());
  const storageAllowed = env.BRAVE_SEARCH_STORAGE_ALLOWED === "true";
  return { provider: "brave" as const, configured: hasKey && storageAllowed, hasKey, storageAllowed };
}

/** Parse only supported public ATS paths. Search-result URLs are never fetched. */
export function boardFromUrl(raw: string): { source: Board; url: string } | null {
  try {
    if (raw.length > 2000 || /[\\\s%]/.test(raw)) return null;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const match = url.hostname === "jobs.lever.co"
      ? /^\/([a-zA-Z0-9_-]{1,100})(?:\/[a-zA-Z0-9_-]+)?\/?$/.exec(url.pathname)
      : ["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(url.hostname)
        ? /^\/([a-zA-Z0-9_-]{1,100})(?:\/jobs\/\d+)?\/?$/.exec(url.pathname) : null;
    if (!match) return null;
    const board = match[1]!.toLowerCase();
    // URL normalization must not hide traversal before validating the path.
    if (raw.includes("/../") || raw.includes("/./")) return null;
    const source = BoardSchema.parse({ provider: url.hostname === "jobs.lever.co" ? "lever" : "greenhouse", board, company: board });
    return { source, url: source.provider === "lever" ? `https://jobs.lever.co/${board}` : `https://job-boards.greenhouse.io/${board}` };
  } catch { return null; }
}

const SearchResponse = z.object({ type: z.literal("search"), web: z.object({
  results: z.array(z.object({ url: z.string().max(2000) })).max(20),
}).optional() });
export type SourceSearchProvider = (query: string) => Promise<string[]>;

/** Credentials stay in a header to the single fixed API endpoint, never the URL. */
export function braveSearchProvider(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch): SourceSearchProvider {
  const config = sourceSearchConfiguration(env);
  if (!config.hasKey) throw new SourceSearchError("Add BRAVE_SEARCH_API_KEY on the server and restart to discover new sources.", 503);
  if (!config.storageAllowed) throw new SourceSearchError("Confirm your Brave plan permits result storage, then set BRAVE_SEARCH_STORAGE_ALLOWED=true.", 503);
  const key = env.BRAVE_SEARCH_API_KEY!.trim();
  return async (query) => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({ q: query, country: "CA", search_lang: "en", count: "20", result_filter: "web", text_decorations: "false", spellcheck: "false" }).toString();
    try {
      const response = await fetcher(url.toString(), { headers: { Accept: "application/json", "X-Subscription-Token": key },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) throw new SourceSearchError("Search rate limit reached. Try later; no automatic paid retry was made.", 429);
      if (!response.ok || !response.body) throw new Error("Search unavailable");
      if (Number(response.headers.get("content-length")) > 1_000_000) throw new Error("Too large");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1_000_000) throw new Error("Too large");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const result = SearchResponse.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return result.web?.results.map((row) => row.url) ?? [];
    } catch (error) {
      if (error instanceof SourceSearchError) throw error;
      throw new SourceSearchError("Search failed or returned an invalid response. Previous suggestions were retained; check the key and try later.", 502);
    }
  };
}

let searching = false;
/** One bounded user-triggered search; discovery does not add sources or import jobs. */
export async function searchJobSources(query: string, dependencies?: { search: SourceSearchProvider; fetchBoard: typeof fetchBoard }) {
  const input = SourceQuerySchema.safeParse(query);
  if (!input.success) throw new SourceSearchError("Enter 3–400 characters and at most 55 words for source search.", 400);
  if (searching) throw new SourceSearchError("A source search is already running. Wait for it to finish.", 409);
  searching = true;
  try {
    const deps = dependencies ?? { search: braveSearchProvider(), fetchBoard };
    const initial = await readDiscoveryStore();
    const fullQuery = `${input.data} ${SITES}`;
    const urls = await deps.search(fullQuery);
    if (urls.length > 20) throw new SourceSearchError("Search returned too many results.");
    const seen = new Set(initial.config.boards.map((s) => `${s.provider}:${s.board.toLowerCase()}`));
    const candidates: NonNullable<ReturnType<typeof boardFromUrl>>[] = [];
    for (const url of urls) {
      const found = boardFromUrl(url);
      if (!found) continue;
      const id = `${found.source.provider}:${found.source.board}`;
      if (seen.has(id) || candidates.length >= 6) continue;
      seen.add(id); candidates.push(found);
    }
    const suggestions: SourceSearch["suggestions"] = [];
    for (let offset = 0; offset < candidates.length; offset += 3) {
      suggestions.push(...await Promise.all(candidates.slice(offset, offset + 3).map(async ({ source, url }) => {
        const base = { id: `${source.provider}:${source.board}`, source, url, checkedAt: new Date().toISOString() };
        try {
          const jobs = await deps.fetchBoard(source);
          return { ...base, status: "verified" as const, jobCount: jobs.length,
            matchingCount: jobs.filter((job) => rankJob(job, initial.config.preferences).eligible).length,
            message: "Public feed verified. Company label is the board token; review it before use." };
        } catch {
          return { ...base, status: "unavailable" as const, jobCount: 0, matchingCount: 0, message: "Could not verify a complete public feed. This source cannot be added from this result." };
        }
      })));
    }
    return updateDiscoveryStore((current) => {
      if (JSON.stringify(current.config) !== JSON.stringify(initial.config)) throw new SourceSearchError("Search settings changed. Run source search again.", 409);
      return { ...current, sourceSearch: { id: randomUUID(), query: fullQuery, finishedAt: new Date().toISOString(),
        preferencesHash: sha256(JSON.stringify(initial.config.preferences)), resultCount: urls.length,
        skippedCount: urls.length - candidates.length, suggestions } };
    });
  } finally { searching = false; }
}

export async function addDiscoveredSource(searchId: string, suggestionId: string, company: string) {
  return updateDiscoveryStore((current) => {
    const search = current.sourceSearch;
    if (!search || search.id !== searchId || Date.now() - Date.parse(search.finishedAt) > 24 * 60 * 60_000)
      throw new SourceSearchError("This source search expired or was replaced. Search again before adding a source.", 409);
    const suggestion = search.suggestions.find((entry) => entry.id === suggestionId);
    if (!suggestion || suggestion.status !== "verified") throw new SourceSearchError("Choose a verified source from the current results.", 409);
    const parsed = BoardSchema.safeParse({ ...suggestion.source, company });
    if (!parsed.success) throw new SourceSearchError("Enter a company label of 1–200 characters.", 400);
    if (current.config.boards.some((source) => source.provider === parsed.data.provider && source.board.toLowerCase() === parsed.data.board)) return current;
    if (current.config.boards.length >= 12) throw new SourceSearchError("Remove a source before adding another (12-source limit).", 409);
    return { ...current, config: { ...current.config, boards: [...current.config.boards, parsed.data] } };
  });
}
