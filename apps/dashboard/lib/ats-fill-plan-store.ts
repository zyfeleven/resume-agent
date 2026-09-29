import { z } from "zod";
import { createJsonStore } from "./local-store";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Target = z.object({ ref: z.string(), id: z.string(), name: z.string(), label: z.string(), tag: z.string(), type: z.string() }).strict();
export const AtsFillRowSchema = z.object({
  questionId: z.string(), label: z.string(), required: z.boolean(), status: z.enum(["planned", "manual"]),
  text: z.string().max(2000).nullable(), factIds: z.array(z.string()).max(20), target: Target.nullable(), reason: z.string(),
}).strict();
export const AtsFillPlanSchema = z.object({
  id: z.string(), taskId: z.string(), fingerprint: Hash, schemaHash: Hash, answerPlanId: z.string(), answerPlanHash: Hash,
  answerReviewsHash: Hash, profileHash: Hash, approvedAt: z.string(), observationHash: Hash, observedAt: z.string().datetime(),
  targetUrl: z.string().url(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  rows: z.array(AtsFillRowSchema).max(500), limitations: z.array(z.string()).max(50), blockers: z.array(z.string()).max(50),
  extraControls: z.array(z.object({ label: z.string(), type: z.string(), required: z.boolean() }).strict()).max(300),
  planHash: Hash, reviews: z.array(z.object({ decision: z.enum(["approved", "rejected"]), decidedAt: z.string().datetime() }).strict()),
}).strict();
export type AtsFillPlan = z.infer<typeof AtsFillPlanSchema>;
export type AtsFillRow = z.infer<typeof AtsFillRowSchema>;
const store = createJsonStore({ fileName: "ats-fill-plans.json", schema: z.object({ version: z.literal(1), plans: z.array(AtsFillPlanSchema) }).strict(),
  empty: () => ({ version: 1 as const, plans: [] as AtsFillPlan[] }) });
export const readAtsFillStore = store.read;
export const updateAtsFillStore = store.update;
