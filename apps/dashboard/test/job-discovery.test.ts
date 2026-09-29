import { describe, expect, it, vi } from "vitest";
import { BoardSchema, defaultDiscoveryConfig, rankJob, type Board } from "../lib/discovery-model";
import { fetchBoard, plainJobText } from "../lib/job-discovery";

export const SOURCE: Board = { provider: "greenhouse", board: "example", company: "Example" };
export const NOW = "2026-09-16T12:00:00.000Z";
export const GH_ROW = { id: 17, title: "Software Engineer", absolute_url: "https://job-boards.greenhouse.io/example/jobs/17?utm_source=test", location: { name: "Ottawa, Ontario, Canada" }, content: "<h2>Requirements</h2><p>Python and SQL experience.</p>", updated_at: NOW };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
export async function candidate() {
  return (await fetchBoard(SOURCE, vi.fn(async () => json({ jobs: [GH_ROW], meta: { total: 1 } })), NOW))[0]!;
}

describe("public job sources", () => {
  it("normalizes encoded Greenhouse content and keeps updates distinct from first seen", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ jobs: [{ ...GH_ROW, content: "&lt;p&gt;Python &amp;amp; SQL&lt;/p&gt;" }], meta: { total: 1 } }));
    const [job] = await fetchBoard(SOURCE, fetcher, NOW);
    expect(job?.description).toBe("Python & SQL");
    expect(job?.url).not.toContain("utm_");
    expect(job?.firstSeenAt).toBe(NOW);
    expect(fetcher.mock.calls[0]?.[0]).toContain("boards-api.greenhouse.io/v1/boards/example/jobs?content=true");
    expect(plainJobText("<script>bad()</script><p>Experience</p><p>Python</p>")).toBe("Experience\nPython");
  });
  it("refuses path injection, malformed feeds and incomplete successful responses", async () => {
    expect(BoardSchema.safeParse({ ...SOURCE, board: "../localhost" }).success).toBe(false);
    await expect(fetchBoard(SOURCE, vi.fn(async () => json({ jobs: [GH_ROW], meta: { total: 2 } })))).rejects.toThrow(/incomplete/);
    await expect(fetchBoard(SOURCE, vi.fn(async () => json({ jobs: [GH_ROW, GH_ROW], meta: { total: 2 } })))).rejects.toThrow(/duplicate/);
    await expect(fetchBoard(SOURCE, vi.fn(async () => new Response("private", { status: 429 })))).rejects.toThrow(/429/);
    await expect(fetchBoard(SOURCE, vi.fn(async () => json({ jobs: [{ ...GH_ROW, absolute_url: "javascript:alert(1)" }], meta: { total: 1 } })))).rejects.toThrow();
  });
  it("paginates Lever and includes all locations and list content", async () => {
    const row = (id: number) => ({ id: String(id), text: "AI Engineer", hostedUrl: `https://jobs.lever.co/example/${id}`, categories: { location: "Calgary", allLocations: ["Toronto", "Calgary"] }, descriptionPlain: "Build systems.", lists: [{ text: "Requirements", content: "<li>Python experience</li>" }] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, i) => row(i)))).mockResolvedValueOnce(json([row(100)]));
    const jobs = await fetchBoard({ ...SOURCE, provider: "lever" }, fetcher, NOW);
    expect(jobs).toHaveLength(101);
    expect(jobs[0]?.location).toContain("Toronto");
    expect(jobs[0]?.description).toContain("Requirements\nPython experience");
    expect(fetcher.mock.calls[1]?.[0]).toContain("skip=100");
  });
  it("scores regional preferences without silently accepting generic US remote or inflated qualification claims", async () => {
    const job = await candidate();
    const prefs = defaultDiscoveryConfig.preferences;
    expect(rankJob(job, prefs).eligible).toBe(true);
    for (const location of ["Kingston, Ontario", "Mississauga", "Markham"]) expect(rankJob({ ...job, location }, prefs).eligible).toBe(true);
    for (const location of ["Remote", "Remote, USA", "Kingston, New York", "Vancouver"]) expect(rankJob({ ...job, location }, prefs).eligible).toBe(false);
    expect(rankJob({ ...job, title: "Senior Software Engineer" }, prefs).eligible).toBe(false);
    expect(rankJob({ ...job, title: "AI Engineer" }, prefs).eligible).toBe(true);
    expect(rankJob({ ...job, title: "Retail Engineer" }, { ...prefs, roles: ["AI"] }).eligible).toBe(false);
  });
});

// Explicit opt-in smoke check; normal tests never contact an external service.
it.skipIf(process.env.RESUME_AGENT_LIVE_DISCOVERY !== "1")("reads the configured public starter boards", async () => {
  for (const board of defaultDiscoveryConfig.boards) {
    const jobs = await fetchBoard(board);
    console.info(`${board.provider}/${board.board}: ${jobs.length} current openings`);
    expect(Array.isArray(jobs)).toBe(true); // An empty complete feed is valid, not a transport failure.
    expect(jobs.every((job) => job.url.startsWith("https://"))).toBe(true);
  }
}, 150_000);
