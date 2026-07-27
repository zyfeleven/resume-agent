import { NextResponse } from "next/server";

import { toProfilePayload } from "../../../lib/profile-payload";
import { clearProfileStore, readProfileStore } from "../../../lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toProfilePayload(await readProfileStore()));
}

/** Delete every locally imported fact and source file. */
export async function DELETE() {
  return NextResponse.json(toProfilePayload(await clearProfileStore()));
}
