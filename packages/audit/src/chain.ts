import { AuditEventSchema, type AuditEvent, type JsonValue } from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { AuditError } from "./errors.js";
import { findUnredacted } from "./redaction.js";

export const AUDIT_VERSION = "audit-chain-v1";

export interface AppendAuditInput {
  actorType: AuditEvent["actorType"];
  actorId: string;
  eventType: string;
  payload: Record<string, JsonValue>;
  occurredAt: string;
  runId?: string;
  applicationId?: string;
}

/**
 * Digest over everything an event asserts, including the event before it.
 *
 * Chaining is what makes the timeline evidence rather than a list: an event cannot be
 * altered, removed, or reordered without breaking every digest after it.
 */
function eventHashOf(input: {
  id: string;
  actorType: string;
  actorId: string;
  eventType: string;
  payload: Record<string, JsonValue>;
  occurredAt: string;
  runId?: string;
  applicationId?: string;
  previousEventHash?: string;
}): string {
  const encoded = JSON.stringify([
    input.previousEventHash ?? "",
    input.id,
    input.actorType,
    input.actorId,
    input.eventType,
    input.runId ?? "",
    input.applicationId ?? "",
    input.occurredAt,
    input.payload,
  ]);
  return createHash("sha256").update(encoded).digest("hex");
}

/**
 * Add one event to the end of a chain.
 *
 * The payload is checked before anything is written, and an unredacted one is refused
 * outright. A caller cannot opt out: there is no parameter that turns the check off, so
 * `redacted: true` on a stored event is a fact about that event rather than a claim by
 * whoever recorded it.
 */
export function appendAuditEvent(previous: AuditEvent | null, input: AppendAuditInput): AuditEvent {
  const findings = findUnredacted(input.payload);
  if (findings.length > 0) {
    throw new AuditError(
      "UNREDACTED_PAYLOAD",
      `This audit payload would have written ${findings.map((finding) => finding.code).join(", ")} to the timeline.`,
      findings,
    );
  }

  const sequence = previous ? Number(previous.id.split(":").pop() ?? 0) + 1 : 1;
  const id = `audit-event:${String(sequence).padStart(8, "0")}`;

  const event = {
    id,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
    actorType: input.actorType,
    actorId: input.actorId,
    eventType: input.eventType.slice(0, 240),
    payload: input.payload,
    redacted: true,
    ...(previous === null ? {} : { previousEventHash: previous.eventHash }),
    occurredAt: input.occurredAt,
  };

  return AuditEventSchema.parse({
    ...event,
    eventHash: eventHashOf({
      ...event,
      ...(previous === null ? {} : { previousEventHash: previous.eventHash }),
    }),
  });
}

export interface ChainVerification {
  intact: boolean;
  length: number;
  /** Index of the first event that does not match its own digest or its predecessor. */
  brokenAt: number | null;
  reason: string | null;
}

/**
 * Re-derive every digest in a stored timeline.
 *
 * A timeline that cannot be verified is worth less than no timeline at all, because it
 * invites belief it has not earned. This says plainly where the chain stops holding.
 */
export function verifyAuditChain(events: readonly AuditEvent[]): ChainVerification {
  let previous: AuditEvent | null = null;

  for (const [index, event] of events.entries()) {
    const expectedPrevious = previous?.eventHash;
    if (event.previousEventHash !== expectedPrevious) {
      return {
        intact: false,
        length: events.length,
        brokenAt: index,
        reason:
          previous === null
            ? "The first event claims a predecessor."
            : "An event does not follow the one before it. Something was removed or reordered.",
      };
    }

    const recomputed = eventHashOf({
      id: event.id,
      actorType: event.actorType,
      actorId: event.actorId,
      eventType: event.eventType,
      payload: event.payload,
      occurredAt: event.occurredAt,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.applicationId === undefined ? {} : { applicationId: event.applicationId }),
      ...(event.previousEventHash === undefined ? {} : { previousEventHash: event.previousEventHash }),
    });

    if (recomputed !== event.eventHash) {
      return {
        intact: false,
        length: events.length,
        brokenAt: index,
        reason: "An event's contents no longer match its digest. It was altered after it was written.",
      };
    }

    previous = event;
  }

  return { intact: true, length: events.length, brokenAt: null, reason: null };
}
