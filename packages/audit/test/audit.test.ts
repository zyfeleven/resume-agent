import type { AuditEvent } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { AuditError, appendAuditEvent, findUnredacted, verifyAuditChain } from "../src/index.js";

const NOW = "2026-07-28T09:00:00-04:00";

function append(previous: AuditEvent | null, eventType: string, payload: Record<string, unknown> = {}): AuditEvent {
  return appendAuditEvent(previous, {
    actorType: "policy_engine",
    actorId: "policy:local",
    eventType,
    payload: payload as never,
    occurredAt: NOW,
  });
}

function chainOf(...types: string[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  let previous: AuditEvent | null = null;
  for (const type of types) {
    previous = append(previous, type, { route: "automatic" });
    events.push(previous);
  }
  return events;
}

describe("redaction", () => {
  it("refuses a payload carrying an answer someone typed", () => {
    expect(() => append(null, "browser.field_written", { value: "maya.chen@example.com" })).toThrow(AuditError);
    expect(() => append(null, "browser.field_written", { value: "(415) 555-0142" })).toThrow(/phone_number/);
  });

  it("refuses a payload carrying a credential", () => {
    expect(() => append(null, "runner.note", { detail: "password is hunter2" })).toThrow(/credential/);
    expect(() => append(null, "runner.note", { detail: "sk-abcdefghijklmnopqrstuvwx" })).toThrow(/credential/);
  });

  it("refuses free text long enough to hide an answer inside it", () => {
    expect(() => append(null, "runner.note", { detail: "x".repeat(301) })).toThrow(/free_text/);
  });

  it("accepts the identifiers, hashes, counts, and reasons an audit trail is for", () => {
    const event = append(null, "browser.field_written", {
      targetId: "target:9f2a",
      canonicalField: "email",
      route: "automatic",
      reasons: ["high_confidence_verified_fact"],
      valueHash: "a".repeat(64),
      applied: true,
      writeCount: 3,
    });

    expect(event.redacted).toBe(true);
    expect(event.payload.canonicalField).toBe("email");
  });

  it("does not mistake a digest for a payment number", () => {
    expect(findUnredacted({ contentHash: "b".repeat(64) })).toEqual([]);
    expect(findUnredacted({ card: "4111 1111 1111 1111" })[0]?.code).toBe("payment_number");
  });

  it("reports where in a nested payload the problem is", () => {
    const findings = findUnredacted({ write: { field: { value: "maya.chen@example.com" } } } as never);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("write.field.value");
    expect(findings[0]?.code).toBe("email_address");
  });

  it("cannot be turned off by the caller", () => {
    // There is no parameter that skips the check, so `redacted` is a fact about the event.
    expect(() => append(null, "runner.note", { detail: "password: hunter2", redacted: true })).toThrow(AuditError);
  });
});

describe("chain", () => {
  it("links every event to the one before it", () => {
    const [first, second, third] = chainOf("a", "b", "c");

    expect(first?.previousEventHash).toBeUndefined();
    expect(second?.previousEventHash).toBe(first?.eventHash);
    expect(third?.previousEventHash).toBe(second?.eventHash);
    expect(verifyAuditChain([first, second, third] as AuditEvent[]).intact).toBe(true);
  });

  it("numbers events in the order they happened", () => {
    const events = chainOf("a", "b", "c");
    expect(events.map((event) => event.id)).toEqual([
      "audit-event:00000001",
      "audit-event:00000002",
      "audit-event:00000003",
    ]);
  });

  it("detects an event altered after it was written", () => {
    const events = chainOf("a", "b", "c");
    const tampered = events.map((event, index) =>
      index === 1 ? { ...event, payload: { route: "prohibited" } } : event,
    );

    const result = verifyAuditChain(tampered);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toMatch(/altered/);
  });

  it("detects a removed event", () => {
    const events = chainOf("a", "b", "c");
    const result = verifyAuditChain([events[0], events[2]] as AuditEvent[]);

    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toMatch(/removed or reordered/);
  });

  it("detects reordering", () => {
    const events = chainOf("a", "b", "c");
    const result = verifyAuditChain([events[0], events[2], events[1]] as AuditEvent[]);

    expect(result.intact).toBe(false);
  });

  it("accepts an empty timeline", () => {
    expect(verifyAuditChain([])).toEqual({ intact: true, length: 0, brokenAt: null, reason: null });
  });

  it("records who acted and what they were", () => {
    const event = appendAuditEvent(null, {
      actorType: "user",
      actorId: "user:local",
      eventType: "profile.fact_verified",
      payload: { factId: "fact:9f2a", decision: "verified" },
      occurredAt: NOW,
      runId: "run:1",
    });

    expect(event.actorType).toBe("user");
    expect(event.runId).toBe("run:1");
    expect(event.eventType).toBe("profile.fact_verified");
  });
});
