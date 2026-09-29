import { NextResponse } from "next/server";

import { clearAuditStore, readAuditTimeline } from "../../../lib/audit-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readAuditTimeline());
}

/**
 * Delete the whole timeline.
 *
 * The chain is cleared rather than edited, so whatever remains is always verifiable. A
 * trail this tool would not let the user delete would be a promise it has not earned the
 * right to make on their own machine.
 */
export async function DELETE() {
  await clearAuditStore();
  return NextResponse.json(await readAuditTimeline());
}
