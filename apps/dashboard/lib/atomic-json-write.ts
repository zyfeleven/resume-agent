import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { platform } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const RETRY_DELAYS_MS = [20, 50, 100, 200] as const;

async function replace(temporary: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, target);
      return;
    } catch (error) {
      const code = typeof error === "object" && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
      const wait = RETRY_DELAYS_MS[attempt];
      // Windows can refuse a replacement while another handle is briefly open.
      // Retry only the same rename, never a write/callback or a delete+copy fallback.
      // Persistent failures and all other errors retain their original failure semantics.
      if (platform() !== "win32" || !["EPERM", "EBUSY"].includes(code ?? "") || wait === undefined) throw error;
      await delay(wait);
    }
  }
}

/** Publish already-validated JSON beside its target. Caller owns the write queue.
 * Atomic visibility, not a multi-process transaction or a power-loss durability guarantee. */
export async function writeJsonAtomically(target: string, contents: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  // Exclusive creation means cleanup can never remove a pre-existing staging file.
  const handle = await open(temporary, "wx");
  try {
    try { await handle.writeFile(contents, "utf8"); }
    finally { await handle.close(); }
    await replace(temporary, target);
  } finally {
    // Remove only our uncommitted staging file. Never remove/truncate the old target.
    // Cleanup failure must not hide the primary write/rename error or turn a commit into failure.
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
