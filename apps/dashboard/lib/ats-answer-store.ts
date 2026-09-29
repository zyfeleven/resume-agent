import { z } from "zod";
import { createJsonStore } from "./local-store";

export const AtsAnswerSchema = z.object({
  questionId: z.string(), label: z.string(), required: z.boolean(),
  text: z.string().max(2000).nullable(), factIds: z.array(z.string()).max(20),
  disposition: z.enum(["draft", "manual"]), reason: z.string(),
}).strict();
export const AtsAnswerPlanSchema = z.object({
  id: z.string(), taskId: z.string(), candidateId: z.string(), fingerprint: z.string(), approvedAt: z.string(),
  schemaHash: z.string(), profileHash: z.string(), model: z.string(), generatedAt: z.string(),
  answers: z.array(AtsAnswerSchema).max(500), planHash: z.string(),
  reviews: z.array(z.object({ questionId: z.string(), decision: z.enum(["approved", "rejected"]), decidedAt: z.string() }).strict()),
}).strict();
export type AtsAnswerPlan = z.infer<typeof AtsAnswerPlanSchema>;
export type AtsAnswer = z.infer<typeof AtsAnswerSchema>;
const store = createJsonStore({ fileName: "ats-answer-plans.json", schema: z.object({ version: z.literal(1), plans: z.array(AtsAnswerPlanSchema) }).strict(),
  empty: () => ({ version: 1 as const, plans: [] as AtsAnswerPlan[] }) });
export const readAtsAnswerStore = store.read;
export const updateAtsAnswerStore = store.update;
