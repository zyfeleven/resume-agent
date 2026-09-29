import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/agent/route";
import { DiscoveryStoreSchema } from "../lib/discovery-model";
import { emptyDiscoveryStore, readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { braveWebSearchProvider } from "../lib/job-source-search";
import { canonicalWebJobUrl } from "../lib/web-job-model";
import { decideWebLead, searchWebJobs } from "../lib/web-job-search";

const QUERY = "junior software engineer jobs Ottawa Canada";
const URL_A = "https://www.linkedin.com/jobs/view/123";
const row = (url = URL_A, title = "Example Engineer — Ottawa") => ({ url, title, description: "Unverified search summary" });
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/agent", {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
});

describe("general job search URL boundary", () => {
  it.each(["javascript:alert(1)", "http://linkedin.com/jobs/1", "https://user:pass@linkedin.com/jobs/1",
    "https://linkedin.com:8443/jobs/1", "https://127.0.0.1/a", "https://2130706433/a", "https://[::1]/a",
    "https://localhost/a", "https://a.local/a", "https://a.internal/a", "https://a.test/a", "https://intranet/a",
    "https://linkedin.com\\@localhost/a", "https://linkedin.com/a\n"]) ("rejects unsafe/non-public link %s", (url) => {
    expect(canonicalWebJobUrl(url)).toBeNull();
  });
  it("removes known tracking while preserving job identity query parameters", () => {
    expect(canonicalWebJobUrl("https://CA.indeed.com/viewjob?utm_source=web&jk=abc&fbclid=123#apply"))
      .toBe("https://ca.indeed.com/viewjob?jk=abc");
    expect(canonicalWebJobUrl("https://careers.company.ca/job?b=2&a=1")).toBe("https://careers.company.ca/job?a=1&b=2");
    expect(canonicalWebJobUrl("https://ca.indeed.com/viewjob?jk=def")).not.toBe(canonicalWebJobUrl("https://ca.indeed.com/viewjob?jk=abc"));
  });
  it("preserves text as inert data and makes only one request to the search API", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ type: "search", web: { results: [row(URL_A, "<script>untrusted</script>")] } })));
    const results = await braveWebSearchProvider({ BRAVE_SEARCH_API_KEY: "test-search-key", BRAVE_SEARCH_STORAGE_ALLOWED: "true" }, fetcher)(QUERY);
    expect(results[0]?.title).toBe("<script>untrusted</script>");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(call[0]).searchParams.get("q")).toBe(QUERY);
    expect(new URL(call[0]).origin).toBe("https://api.search.brave.com");
    expect(call[1].redirect).toBe("error");
  });
});

describe("general job search persistence and route", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "web-job-search-test-"));
    vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_STORAGE_ALLOWED", "false");
  });
  afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
  it("migrates old stores without changing board jobs", () => {
    const { webLeads: ignoredLeads, webSearch: ignoredSearch, ...old } = emptyDiscoveryStore();
    expect(DiscoveryStoreSchema.parse(old)).toMatchObject({ webLeads: [], webSearch: null, jobs: [] });
  });
  it("searches without site restrictions, deduplicates and never creates applications", async () => {
    const search = vi.fn(async () => [row(), row(`${URL_A}?utm_source=test`), row("https://ca.indeed.com/viewjob?jk=abc"), row("https://careers.company.ca/jobs/2"), row("https://localhost/a")]);
    const store = await searchWebJobs(QUERY, search);
    expect(search).toHaveBeenCalledExactlyOnceWith(QUERY);
    expect(store.webSearch).toMatchObject({ resultCount: 5, skippedCount: 2 });
    expect(store.webLeads).toHaveLength(3);
    expect(store.jobs).toEqual([]); expect(store.tasks).toEqual([]);
    expect(store.config).toEqual(emptyDiscoveryStore().config);
  });
  it("keeps saved/dismissed decisions across queries but replaces old undecided results", async () => {
    const initial = await searchWebJobs(QUERY, async () => [row(), row("https://careers.company.ca/jobs/2"), row("https://careers.company.ca/jobs/3")]);
    const [saved, dismissed] = initial.webLeads;
    await decideWebLead(saved!.id, saved!.fingerprint, "saved");
    await decideWebLead(dismissed!.id, dismissed!.fingerprint, "dismissed");
    const updated = await searchWebJobs("new jobs Kingston", async () => [row("https://careers.company.ca/jobs/4")]);
    expect(updated.webLeads).toHaveLength(3);
    expect(updated.webLeads.find((lead) => lead.id === saved!.id)?.decision).toBe("saved");
    expect(updated.webLeads.find((lead) => lead.id === dismissed!.id)?.decision).toBe("dismissed");
    expect(updated.webSearch?.leadIds).toHaveLength(1);
    expect((await readDiscoveryStore()).webLeads).toEqual(updated.webLeads);
  });
  it("rejects stale decisions when the search snippet changed and supports reset", async () => {
    const first = (await searchWebJobs(QUERY, async () => [row()])).webLeads[0]!;
    await decideWebLead(first.id, first.fingerprint, "saved");
    const next = (await searchWebJobs(QUERY, async () => [row(URL_A, "Updated title")])).webLeads[0]!;
    expect(next.decision).toBe("saved"); expect(next.firstSeenAt).toBe(first.firstSeenAt);
    await expect(decideWebLead(first.id, first.fingerprint, "dismissed")).rejects.toMatchObject({ status: 409 });
    expect((await decideWebLead(next.id, next.fingerprint, "new")).webLeads[0]?.decision).toBe("new");
  });
  it("retains the previous search on failure and bounds results", async () => {
    const initial = await searchWebJobs(QUERY, async () => [row()]);
    await expect(searchWebJobs(QUERY, async () => { throw new Error("offline"); })).rejects.toThrow();
    await expect(searchWebJobs(QUERY, async () => Array.from({ length: 21 }, () => row()))).rejects.toMatchObject({ status: 502 });
    expect((await readDiscoveryStore()).webSearch).toEqual(initial.webSearch);
    await expect(searchWebJobs("x", async () => [])).rejects.toMatchObject({ status: 400 });
  });
  it("prevents simultaneous paid searches and releases the lock after a failure", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const running = searchWebJobs(QUERY, async () => { await pending; throw new Error("offline"); });
    await expect(searchWebJobs(QUERY, async () => [])).rejects.toMatchObject({ status: 409 });
    finish(); await expect(running).rejects.toThrow();
    expect((await searchWebJobs(QUERY, async () => [])).webSearch?.resultCount).toBe(0);
  });
  it("bounds retained decisions without silently losing them", async () => {
    const first = (await searchWebJobs(QUERY, async () => [row()])).webLeads[0]!;
    await updateDiscoveryStore((store) => ({ ...store, webLeads: Array.from({ length: 200 }, (_, i) => ({
      ...first, id: i.toString(16).padStart(64, "0"), url: `https://company.ca/jobs/${i}`, decision: "saved" as const,
    })) }));
    await expect(searchWebJobs(QUERY, async () => [row()])).rejects.toMatchObject({ status: 409 });
    expect((await readDiscoveryStore()).webLeads).toHaveLength(200);
  });
  it("requires configuration, prevents cross-origin and approval commands, and sends no keyless request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await POST(request({ action: "search_web", query: QUERY }))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await POST(request({ action: "search_web", query: QUERY }, "https://evil.test"))).status).toBe(403);
    expect((await POST(request({ action: "search_web", query: QUERY, provider: "arbitrary" }))).status).toBe(400);
    const lead = (await searchWebJobs(QUERY, async () => [row()])).webLeads[0]!;
    expect((await POST(request({ action: "decide_web", id: lead.id, fingerprint: lead.fingerprint, decision: "approved" }))).status).toBe(400);
    const response = await POST(request({ action: "decide_web", id: lead.id, fingerprint: lead.fingerprint, decision: "saved" }));
    expect(response.status).toBe(200);
    expect((await response.json()).webLeads[0].decision).toBe("saved");
    expect((await readDiscoveryStore()).tasks).toEqual([]);
  });
  it("connects the real route to a mocked provider and returns no credentials", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "synthetic-search-key");
    vi.stubEnv("BRAVE_SEARCH_STORAGE_ALLOWED", "true");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ type: "search", web: { results: [row()] } })));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ action: "search_web", query: QUERY }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.webLeads[0].url).toBe(URL_A);
    expect(JSON.stringify(payload)).not.toContain("synthetic-search-key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const before = (await readDiscoveryStore()).webSearch;
    fetcher.mockImplementation(async () => { throw new Error("synthetic-search-key upstream secret"); });
    const failed = await POST(request({ action: "search_web", query: QUERY }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("synthetic-search-key");
    expect((await readDiscoveryStore()).webSearch).toEqual(before);
  });
});
