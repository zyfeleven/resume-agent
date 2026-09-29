import { NextResponse } from "next/server";

import { recordAuditEvent } from "../../../lib/audit-store";

import { toProfilePayload } from "../../../lib/profile-payload";
import { clearProfileStore, readProfileStore } from "../../../lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toProfilePayload(await readProfileStore()));
}

/** Delete every locally imported fact and source file. */
export async function DELETE() {
  const cleared = toProfilePayload(await clearProfileStore());
  await recordAuditEvent({
    actorType: "user",
    actorId: "user:local",
    eventType: "profile.local_data_deleted",
    payload: { domain: "profile" },
  });
  return NextResponse.json(cleared);
}
