import { randomUUID } from "node:crypto";
import { updateDiscoveryStore } from "./discovery-store";
import { sha256 } from "./job-discovery";
import { braveWebSearchProvider, SourceQuerySchema, SourceSearchError, type WebSearchProvider } from "./job-source-search";
import { canonicalWebJobUrl, WebLeadSchema, type WebLead } from "./web-job-model";

let searching = false;
/** Explicit query, no domain restriction, no destination fetching or automatic applications. */
export async function searchWebJobs(query: string, provider?: WebSearchProvider) {
  const parsed = SourceQuerySchema.safeParse(query);
  if (!parsed.success) throw new SourceSearchError("Enter 3–400 characters and at most 55 words for web search.", 400);
  if (searching) throw new SourceSearchError("A web search is already running. Wait for it to finish.", 409);
  searching = true;
  try {
    const results = await (provider ?? braveWebSearchProvider())(parsed.data);
    if (results.length > 20) throw new SourceSearchError("Search returned too many results.", 502);
    const now = new Date().toISOString();
    const leads = new Map<string, WebLead>();
    for (const row of results) {
      const url = canonicalWebJobUrl(row.url);
      if (!url) continue;
      const id = sha256(url);
      if (leads.has(id)) continue;
      const title = row.title.trim() || new URL(url).hostname;
      leads.set(id, WebLeadSchema.parse({ id, url, title, snippet: row.description,
        fingerprint: sha256(JSON.stringify([url, title, row.description])),
        firstSeenAt: now, lastSeenAt: now, decision: "new" }));
    }
    return updateDiscoveryStore((current) => {
      // Keep saved/dismissed URLs across searches; discard only older undecided results.
      const retained = current.webLeads.filter((lead) => lead.decision !== "new" && !leads.has(lead.id));
      const merged = [...leads.values()].map((lead) => {
        const previous = current.webLeads.find((entry) => entry.id === lead.id);
        return { ...lead, firstSeenAt: previous?.firstSeenAt ?? now, decision: previous?.decision ?? lead.decision };
      });
      if (retained.length + merged.length > 200) throw new SourceSearchError("Web lead storage is full. Reset saved or dismissed leads to New before searching again.", 409);
      return { ...current, webLeads: [...merged, ...retained], webSearch: {
        id: randomUUID(), query: parsed.data, finishedAt: now, resultCount: results.length,
        skippedCount: results.length - leads.size, leadIds: [...leads.keys()],
      } };
    });
  } finally { searching = false; }
}

export async function decideWebLead(id: string, fingerprint: string, decision: WebLead["decision"]) {
  return updateDiscoveryStore((current) => {
    const lead = current.webLeads.find((entry) => entry.id === id);
    if (!lead || lead.fingerprint !== fingerprint) throw new SourceSearchError("This web lead changed. Reload and review it again.", 409);
    return { ...current, webLeads: current.webLeads.map((entry) => entry.id === id ? { ...entry, decision } : entry) };
  });
}
