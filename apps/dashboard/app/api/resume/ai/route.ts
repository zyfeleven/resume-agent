import { ResumeTailorError } from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { recordAuditEvent } from "../../../../lib/audit-store";
import { GeminiResumeError } from "../../../../lib/gemini-resume-provider";
import { ResumeIntelligenceError } from "../../../../lib/resume-intelligence";
import { generateGeminiResume, ResumePreparationError } from "../../../../lib/prepare-agent-resume";
import { buildResumePayload } from "../../../../lib/resume-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const GenerateSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();

export async function POST(request: Request) {
  const parsed = GenerateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: "Choose a job to optimize for." }, { status: 400 });
  try {
    const { store, intelligence, guard, semanticGuard, requirementCount } = await generateGeminiResume(parsed.data.jobId);
    await recordAuditEvent({ actorType: "agent", actorId: `gemini:${intelligence.model}`, eventType: "resume.ai_optimized",
      payload: { provider: intelligence.provider, model: intelligence.model, changeSetId: intelligence.changeSet.id,
        requirementCount, changeCount: intelligence.changeSet.changes.length, guardPassed: guard.passed,
        semanticGuardPassed: semanticGuard.passed,
        ...(intelligence.responseId ? { responseId: intelligence.responseId } : {}),
        ...(intelligence.inputTokens === undefined ? {} : { inputTokens: intelligence.inputTokens }),
        ...(intelligence.outputTokens === undefined ? {} : { outputTokens: intelligence.outputTokens }) },
      applicationId: `application:${parsed.data.jobId}` });
    return NextResponse.json(await buildResumePayload(store, intelligence.changeSet.id), { status: 201 });
  } catch (error) {
    if (error instanceof GeminiResumeError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "GEMINI_NOT_CONFIGURED" ? 503 : 502 });
    if (error instanceof ResumeIntelligenceError) return NextResponse.json({ error: error.code, message: error.message }, { status: 422 });
    if (error instanceof ResumeTailorError) return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    if (error instanceof ResumePreparationError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof ZodError) return NextResponse.json({ error: "GEMINI_INVALID_RESPONSE", message: "Gemini returned a resume plan that failed local validation." }, { status: 502 });
    throw error;
  }
}
