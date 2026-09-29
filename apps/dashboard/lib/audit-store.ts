import { appendAuditEvent, AuditError, verifyAuditChain, type ChainVerification } from "@resume-agent/audit";
import { AuditEventSchema, type AuditEvent, type JsonValue } from "@resume-agent/contracts";
import { z } from "zod";

import { createJsonStore } from "./local-store";

export const AuditStoreSchema = z
  .object({
    version: z.literal(1),
    events: z.array(AuditEventSchema),
  })
  .strict();

export type AuditStore = z.infer<typeof AuditStoreSchema>;

export function emptyAuditStore(): AuditStore {
  return { version: 1, events: [] };
}

const store = createJsonStore({
  fileName: "audit-log.json",
  schema: AuditStoreSchema,
  empty: emptyAuditStore,
});

export const readAuditStore = store.read;

/**
 * Delete the timeline.
 *
 * Offered because the same screen offers deletion of everything else, and a trail the user
 * cannot delete would be a promise this local-first tool has not earned the right to make.
 * It clears the whole chain rather than editing it, so what remains is always verifiable.
 */
export const clearAuditStore = store.clear;

export interface RecordAuditInput {
  actorType: AuditEvent["actorType"];
  actorId: string;
  eventType: string;
  payload: Record<string, JsonValue>;
  runId?: string;
  applicationId?: string;
}

/**
 * Append one event to the durable timeline.
 *
 * Recording must never be the reason a run fails, so a refused payload is reported and
 * swallowed rather than thrown at the caller — but it is reported loudly, because a
 * payload that would have leaked an answer is a bug in the call site, not in the audit.
 */
export async function recordAuditEvent(input: RecordAuditInput): Promise<void> {
  try {
    await store.update((current) => {
      const previous = current.events.at(-1) ?? null;
      const event = appendAuditEvent(previous, {
        ...input,
        occurredAt: new Date().toISOString(),
      });
      return { ...current, events: [...current.events, event] };
    });
  } catch (error) {
    if (error instanceof AuditError) {
      console.error(
        `[audit] refused to record ${input.eventType}: ${error.findings.map((finding) => `${finding.path} (${finding.code})`).join(", ")}`,
      );
      return;
    }
    throw error;
  }
}

export interface AuditTimeline {
  events: AuditEvent[];
  verification: ChainVerification;
}

export async function readAuditTimeline(limit = 200): Promise<AuditTimeline> {
  const { events } = await readAuditStore();
  return {
    // Verification runs over the whole chain, not the page being shown, so a break
    // outside the visible window is still reported.
    verification: verifyAuditChain(events),
    events: events.slice(-limit).reverse(),
  };
}
