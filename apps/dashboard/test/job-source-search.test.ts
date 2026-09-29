import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/agent/route";
import { discoveryPayload } from "../lib/application-agent";
import { DiscoveryStoreSchema } from "../lib/discovery-model";
import { emptyDiscoveryStore, readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { fetchBoard } from "../lib/job-discovery";
import { addDiscoveredSource, boardFromUrl, braveSearchProvider, searchJobSources, sourceSearchConfiguration } from "../lib/job-source-search";

const ENV = { BRAVE_SEARCH_API_KEY: "test-search-key", BRAVE_SEARCH_STORAGE_ALLOWED: "true" };
const QUERY = "software engineer Ottawa Canada";
const URL_A = "https://jobs.lever.co/newco/role-one";
const URL_B = "https://job-boards.greenhouse.io/another/jobs/123";
const searchResponse = (urls: string[]) => new Response(JSON.stringify({ type: "search", web: { results: urls.map((url) => ({ url })) } }));
const verifyFeed: typeof fetchBoard = (source) => fetchBoard({ ...source, provider: "greenhouse" }, async () => new Response(JSON.stringify({
  jobs: [{ id: 1, title: "Software Engineer", absolute_url: "https://job-boards.greenhouse.io/newco/jobs/1", location: { name: "Ottawa, Ontario" }, content: "Python experience required." }], meta: { total: 1 },
})));

describe("search provider and source URL boundary", () => {
  it("requires a search key and explicit storage-rights confirmation, without exposing secrets", () => {
    expect(() => braveSearchProvider({})).toThrow(/BRAVE_SEARCH_API_KEY/);
    expect(() => braveSearchProvider({ BRAVE_SEARCH_API_KEY: "secret" })).toThrow(/storage/);
    expect(sourceSearchConfiguration(ENV)).toEqual({ provider: "brave", configured: true, hasKey: true, storageAllowed: true });
  });
  it("accepts supported board and job URLs and strips query tracking", () => {
    expect(boardFromUrl(`${URL_A}?source=example`)).toEqual({ source: { provider: "lever", board: "newco", company: "newco" }, url: "https://jobs.lever.co/newco" });
    expect(boardFromUrl("https://boards.greenhouse.io/Another/jobs/12")).toMatchObject({ source: { provider: "greenhouse", board: "another" } });
  });
  it.each([
    "http://jobs.lever.co/newco", "https://jobs.lever.co.evil.test/newco", "https://127.0.0.1/newco",
    "https://user:pass@jobs.lever.co/newco", "https://jobs.lever.co:8443/newco", "https://jobs.lever.co/a/../newco",
    "https://jobs.lever.co/%6eewco", "https://job-boards.greenhouse.io/embed/job_board?for=example", "javascript:alert(1)",
  ])("rejects an unsupported or disguised URL: %s", (url) => { expect(boardFromUrl(url)).toBeNull(); });
  it("calls only the fixed API endpoint with bounded results and credentials in headers", async () => {
    const fetcher = vi.fn(async () => searchResponse([URL_A]));
    expect(await braveSearchProvider(ENV, fetcher)(QUERY)).toEqual([URL_A]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [raw, options] = vi.mocked(fetcher).mock.calls[0]! as unknown as [string, RequestInit];
    const url = new URL(raw);
    expect(url.origin).toBe("https://api.search.brave.com");
    expect(url.searchParams.get("country")).toBe("CA");
    expect(url.searchParams.get("count")).toBe("20");
    expect(raw).not.toContain(ENV.BRAVE_SEARCH_API_KEY);
    expect(options).toMatchObject({ redirect: "error", headers: { "X-Subscription-Token": ENV.BRAVE_SEARCH_API_KEY } });
  });
  it("redacts failures, rejects invalid/oversized responses, and does not retry 429", async () => {
    const throttled = vi.fn(async () => new Response("provider secret", { status: 429 }));
    await expect(braveSearchProvider(ENV, throttled)(QUERY)).rejects.toMatchObject({ status: 429 });
    expect(throttled).toHaveBeenCalledTimes(1);
    for (const response of [new Response("secret", { status: 401 }), new Response("{}"), new Response("a".repeat(1_000_001))]) {
      await expect(braveSearchProvider(ENV, async () => response)(QUERY)).rejects.toMatchObject({ status: 502 });
    }
    expect(await braveSearchProvider(ENV, async () => new Response('{"type":"search"}'))(QUERY)).toEqual([]);
  });
});

describe("source discovery to explicit enrollment", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "source-discovery-test-"));
    vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_STORAGE_ALLOWED", "false");
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  it("migrates old stores without losing decisions and advertises configuration safely", async () => {
    const { sourceSearch: ignored, ...old } = emptyDiscoveryStore();
    expect(DiscoveryStoreSchema.parse(old).sourceSearch).toBeNull();
    expect((await discoveryPayload(emptyDiscoveryStore())).sourceSearchProvider.configured).toBe(false);
  });
  it("deduplicates and validates public feeds but does not enroll sources or import jobs automatically", async () => {
    const search = vi.fn(async () => [URL_A, `${URL_A}?tracking=1`, URL_B, "https://jobs.lever.co/wealthsimple/old", "https://evil.test/job"]);
    const fetch = vi.fn(verifyFeed);
    const result = await searchJobSources(QUERY, { search, fetchBoard: fetch });
    expect(search).toHaveBeenCalledWith(expect.stringContaining("site:jobs.lever.co"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.sourceSearch).toMatchObject({ resultCount: 5, skippedCount: 3 });
    expect(result.sourceSearch?.suggestions[0]).toMatchObject({ status: "verified", jobCount: 1, matchingCount: 1 });
    expect(result.config.boards).toEqual(emptyDiscoveryStore().config.boards);
    expect(result.jobs).toEqual([]);
    expect(result.tasks).toEqual([]);
    const run = result.sourceSearch!;
    const added = await addDiscoveredSource(run.id, run.suggestions[0]!.id, "New Company");
    expect(added.config.boards.at(-1)).toEqual({ provider: "lever", board: "newco", company: "New Company" });
    expect((await addDiscoveredSource(run.id, run.suggestions[0]!.id, "New Company")).config.boards).toHaveLength(5);
    expect((await readDiscoveryStore()).sourceSearch?.id).toBe(run.id);
  });
  it("bounds feed verification to six and retains unavailable sources without allowing enrollment", async () => {
    const fetch = vi.fn(async () => { throw new Error("private error"); });
    const result = await searchJobSources(QUERY, { search: async () => Array.from({ length: 20 }, (_, i) => `https://jobs.lever.co/board${i}`), fetchBoard: fetch });
    expect(fetch).toHaveBeenCalledTimes(6);
    const run = result.sourceSearch!;
    expect(run.skippedCount).toBe(14);
    expect(run.suggestions[0]?.message).not.toContain("private error");
    await expect(addDiscoveredSource(run.id, run.suggestions[0]!.id, "X")).rejects.toThrow(/verified/);
  });
  it("keeps the previous result on provider failure and refuses replaced or expired suggestions", async () => {
    const result = await searchJobSources(QUERY, { search: async () => [URL_A], fetchBoard: verifyFeed });
    const run = result.sourceSearch!;
    await expect(searchJobSources(QUERY, { search: async () => { throw new Error("offline"); }, fetchBoard: verifyFeed })).rejects.toThrow();
    expect((await readDiscoveryStore()).sourceSearch?.id).toBe(run.id);
    await expect(addDiscoveredSource("replaced", run.suggestions[0]!.id, "X")).rejects.toThrow(/expired/);
    await updateDiscoveryStore((store) => ({ ...store, sourceSearch: { ...run, finishedAt: "2020-01-01T00:00:00.000Z" } }));
    await expect(addDiscoveredSource(run.id, run.suggestions[0]!.id, "X")).rejects.toThrow(/expired/);
  });
  it("rejects concurrent search and changed preferences, then releases its lock", async () => {
    let finish!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const running = searchJobSources(QUERY, { search: async () => { entered(); await pending; return [URL_A]; }, fetchBoard: verifyFeed });
    await ready;
    await expect(searchJobSources(QUERY, { search: async () => [], fetchBoard: verifyFeed })).rejects.toMatchObject({ status: 409 });
    await updateDiscoveryStore((store) => ({ ...store, config: { ...store.config, preferences: { ...store.config.preferences, roles: ["Designer"] } } }));
    finish();
    await expect(running).rejects.toThrow(/settings changed/);
    expect((await searchJobSources(QUERY, { search: async () => [], fetchBoard: verifyFeed })).sourceSearch?.resultCount).toBe(0);
  });
  it("enforces the configured source limit even after a valid search", async () => {
    const result = await searchJobSources(QUERY, { search: async () => [URL_A], fetchBoard: verifyFeed });
    await updateDiscoveryStore((store) => ({ ...store, config: { ...store.config, boards: Array.from({ length: 12 }, (_, i) => ({ provider: "lever", board: `existing${i}`, company: `Existing ${i}` })) } }));
    await expect(addDiscoveredSource(result.sourceSearch!.id, "lever:newco", "New")).rejects.toThrow(/12-source/);
  });
  it("applies route validation and same-origin checks to the new commands", async () => {
    const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/agent", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    expect((await POST(request({ action: "discover_sources", query: QUERY }))).status).toBe(503);
    expect((await POST(request({ action: "discover_sources", query: "x" }))).status).toBe(400);
    expect((await POST(request({ action: "add_source", searchId: "x", suggestionId: "x", company: "X" }, "https://evil.test"))).status).toBe(403);
    expect((await POST(request({ action: "add_source", searchId: "x", suggestionId: "x", company: "X" }))).status).toBe(409);
  });
});
