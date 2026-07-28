import type { BrowserPageSnapshot } from "@resume-agent/contracts";
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "playwright";

import { BrowserRunnerError } from "./errors.js";

export interface WriteReservation {
  reservationId: string;
  nonce: string;
  actionId: string;
  actionFingerprint: string;
  sourceSnapshotId: string;
  pageFingerprint: string;
  pageGeneration: number;
  targetId: string;
  expectedValueHash: string;
  issuedAt: string;
  leaseExpiresAt: string;
}

export interface WriteResult {
  targetId: string;
  canonicalField: string;
  applied: boolean;
  /** Digest of the value the page now holds, computed in the page. */
  observedValueHash: string | null;
  verifiedAt: string;
}

const LEASE_MS = 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A single-use permit to perform one write.
 *
 * The reservation binds the action to the snapshot it was planned against, so a page that
 * changed in between invalidates it. Phase 1 issues the permit inside the runner after
 * its own policy gate; the Browser MCP contract has the orchestrator issue it across the
 * boundary, and the binding fields are already the ones that contract requires.
 */
export class WriteReservations {
  private readonly open = new Map<string, WriteReservation>();
  private readonly consumed = new Set<string>();

  issue(input: {
    snapshot: BrowserPageSnapshot;
    targetId: string;
    expectedValueHash: string;
    issuedAt: string;
  }): WriteReservation {
    const actionId = `action:fill:${input.targetId}`;
    const reservation: WriteReservation = {
      reservationId: `reservation:${randomBytes(12).toString("hex")}`,
      nonce: randomBytes(24).toString("hex"),
      actionId,
      actionFingerprint: sha256(
        JSON.stringify([actionId, input.snapshot.snapshotId, input.snapshot.pageFingerprint, input.targetId, input.expectedValueHash]),
      ),
      sourceSnapshotId: input.snapshot.snapshotId,
      pageFingerprint: input.snapshot.pageFingerprint,
      pageGeneration: input.snapshot.pageGeneration,
      targetId: input.targetId,
      expectedValueHash: input.expectedValueHash,
      issuedAt: input.issuedAt,
      leaseExpiresAt: new Date(Date.parse(input.issuedAt) + LEASE_MS).toISOString(),
    };

    this.open.set(reservation.reservationId, reservation);
    return reservation;
  }

  /** Take the permit. A second attempt with the same one is refused. */
  consume(reservationId: string, nonce: string, now: string): WriteReservation {
    if (this.consumed.has(reservationId)) {
      throw new BrowserRunnerError("RESERVATION_SPENT", "This write was already performed once and cannot be repeated.");
    }

    const reservation = this.open.get(reservationId);
    if (!reservation || reservation.nonce !== nonce) {
      throw new BrowserRunnerError("RESERVATION_SPENT", "No open reservation matches this write.");
    }
    if (Date.parse(now) > Date.parse(reservation.leaseExpiresAt)) {
      this.open.delete(reservationId);
      throw new BrowserRunnerError("RESERVATION_SPENT", "This write reservation expired before it was used.");
    }

    this.open.delete(reservationId);
    this.consumed.add(reservationId);
    return reservation;
  }
}

/**
 * Type one value into one field.
 *
 * The locator comes from the snapshot the write was planned against — never from a
 * caller — and the value is never logged. The result reports only the digest the page
 * computed, so verification is possible without the answer leaving the page.
 */
export async function applyFieldWrite(input: {
  page: Page;
  snapshot: BrowserPageSnapshot;
  reservation: WriteReservation;
  value: string;
  canonicalField: string;
  now: string;
}): Promise<WriteResult> {
  const target = input.snapshot.targets.find((candidate) => candidate.id === input.reservation.targetId);
  if (!target) {
    throw new BrowserRunnerError("STALE_SNAPSHOT", "The write targets a control that is not in this snapshot.");
  }
  if (target.kind === "submit") {
    throw new BrowserRunnerError("SUBMIT_REFUSED", "This runner does not submit applications.");
  }

  const recipe = target.locatorRecipes.find((candidate) => candidate.strategy === "test_id");
  if (!recipe) {
    throw new BrowserRunnerError("STALE_SNAPSHOT", "This control has no locator recipe the runner can resolve.");
  }

  const locator = input.page.getByTestId(recipe.value);
  if ((await locator.count()) !== 1) {
    // Ambiguity fails closed: the runner will not guess which control was meant.
    throw new BrowserRunnerError("STALE_SNAPSHOT", "The control this write targets is no longer uniquely resolvable.");
  }

  await locator.fill(input.value, { timeout: 5_000 });

  const observedValueHash = await locator.evaluate(async (element) => {
    const value = "value" in element && typeof element.value === "string" ? element.value.trim() : "";
    if (value.length === 0) {
      return null;
    }
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });

  return {
    targetId: target.id,
    canonicalField: input.canonicalField,
    applied: observedValueHash === input.reservation.expectedValueHash,
    observedValueHash,
    verifiedAt: input.now,
  };
}

export function normalizedValueHash(value: string): string {
  return sha256(value.trim());
}
