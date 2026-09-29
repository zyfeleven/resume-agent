import { createFormIntelligencePlan } from "./form-intelligence";
import { GeminiFormProvider } from "./gemini-form-provider";
import { readProfileStore, usableProfileFacts } from "./profile-store";
import { browserRunner, runnerPayload, type RunnerPayload } from "./runner-session";
import { recordAuditEvent } from "./audit-store";

export async function runIntelligentForm(mode: "plan" | "fill"): Promise<RunnerPayload> {
  const provider = GeminiFormProvider.fromEnvironment();
  const runner = browserRunner();
  const profile = await readProfileStore();
  const facts = usableProfileFacts(profile);
  const evaluatedAt = new Date().toISOString();
  const startedAt = performance.now();

  const observation = await runner.snapshot(evaluatedAt);
  const intelligence = await createFormIntelligencePlan({
    snapshot: observation.snapshot,
    normalizations: observation.normalizations,
    safetySignals: observation.safetySignals,
    facts,
    provider,
    evaluatedAt,
  });

  const results = mode === "fill"
    ? (await runner.fillPlannedFields({
        plan: intelligence.plan,
        snapshot: observation.snapshot,
        valueByFactId: intelligence.valueByAnswerId,
        now: new Date().toISOString(),
      })).results
    : undefined;

  await recordAuditEvent({
    actorType: "agent",
    actorId: `gemini:${intelligence.model}`,
    eventType: `browser.ai_${mode}`,
    payload: {
      provider: intelligence.provider,
      model: intelligence.model,
      mode,
      proposedCount: intelligence.proposedCount,
      acceptedCount: intelligence.acceptedCount,
      rejectedCount: intelligence.rejected.length,
      automaticCount: intelligence.plan.automaticFieldIds.length,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(intelligence.responseId ? { responseId: intelligence.responseId } : {}),
      ...(intelligence.inputTokens === undefined ? {} : { inputTokens: intelligence.inputTokens }),
      ...(intelligence.outputTokens === undefined ? {} : { outputTokens: intelligence.outputTokens }),
    },
    runId: observation.snapshot.runId,
    applicationId: observation.snapshot.applicationId,
  });

  const payload = await runnerPayload();
  return {
    ...payload,
    plan: intelligence.plan,
    ...(results ? { results } : {}),
    answerValues: {
      ...payload.answerValues,
      ...Object.fromEntries(intelligence.valueByAnswerId),
    },
    intelligenceRun: {
      provider: intelligence.provider,
      model: intelligence.model,
      mode,
      proposedCount: intelligence.proposedCount,
      acceptedCount: intelligence.acceptedCount,
      rejectedCount: intelligence.rejected.length,
      rejected: intelligence.rejected,
      ...(intelligence.responseId ? { responseId: intelligence.responseId } : {}),
      ...(intelligence.inputTokens === undefined ? {} : { inputTokens: intelligence.inputTokens }),
      ...(intelligence.outputTokens === undefined ? {} : { outputTokens: intelligence.outputTokens }),
    },
  };
}
