import { NextResponse } from "next/server";

import { recordAuditEvent } from "../../../../../../lib/audit-store";
import { readJobStore } from "../../../../../../lib/job-store";
import { LOCAL_REVIEWER_ID, readProfileStore } from "../../../../../../lib/profile-store";
import { ResumeRestoreError, restoreResumeVersion } from "../../../../../../lib/resume-version-restore";
import { buildResumePayload } from "../../../../../../lib/resume-view";
import { updateResumeStore } from "../../../../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;
  if (!versionId || versionId.length > 240) {
    return NextResponse.json({ error: "invalid_request", message: "Choose a resume version to restore." }, { status: 400 });
  }

  const restoredAt = new Date().toISOString();
  try {
    let restoredChangeSetId: string | undefined;
    let restoreId: string | undefined;
    const store = await updateResumeStore((current) => {
      const result = restoreResumeVersion(current, {
        versionId,
        restoredBy: LOCAL_REVIEWER_ID,
        restoredAt,
      });
      restoredChangeSetId = result.store.versions.find((entry) => entry.id === versionId)?.changeSetId;
      restoreId = result.restore.id;
      return result.store;
    });

    await recordAuditEvent({
      actorType: "user",
      actorId: LOCAL_REVIEWER_ID,
      eventType: "resume.version_restored",
      payload: {
        versionId,
        ...(restoreId ? { restoreId } : {}),
        ...(restoredChangeSetId ? { changeSetId: restoredChangeSetId } : {}),
      },
    });
    const [profile, jobStore] = await Promise.all([readProfileStore(), readJobStore()]);
    return NextResponse.json(
      await buildResumePayload(store, restoredChangeSetId, { profile, jobStore }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ResumeRestoreError) {
      return NextResponse.json(
        { error: error.code.toLowerCase(), message: error.message },
        { status: error.code === "VERSION_NOT_FOUND" ? 404 : 409 },
      );
    }
    throw error;
  }
}
