import { z } from "zod";

/** Conservative link validation, not a guarantee of destination trust. Never fetched by the server. */
export function canonicalWebJobUrl(raw: string): string | null {
  try {
    if (raw.length > 2000 || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
    const url = new URL(raw);
    const host = url.hostname;
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(?:gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export const WebLeadSchema = z.object({
  id: z.string().length(64), url: z.string().refine((url) => canonicalWebJobUrl(url) === url),
  title: z.string().max(2000), snippet: z.string().max(10000), fingerprint: z.string().length(64),
  firstSeenAt: z.string().datetime(), lastSeenAt: z.string().datetime(),
  decision: z.enum(["new", "saved", "dismissed"]),
}).strict();
export const WebSearchSchema = z.object({
  id: z.string(), query: z.string().max(400), finishedAt: z.string().datetime(),
  resultCount: z.number().int().min(0).max(20), skippedCount: z.number().int().min(0).max(20),
  leadIds: z.array(z.string().length(64)).max(20),
}).strict();
export type WebLead = z.infer<typeof WebLeadSchema>;
