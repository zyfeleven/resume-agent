import { z } from "zod";
import { createJsonStore } from "./local-store";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Control = z.object({ ref: z.string(), id: z.string(), name: z.string(), label: z.string(), tag: z.string(), type: z.string() }).strict();
const AttachmentSchema = z.object({
  id: z.string().uuid(), attachmentHash: Hash,
  artifact: z.object({ buildId: z.string(), outputHash: Hash, byteSize: z.number().int().positive().max(5_000_000), manifestHash: Hash, evidenceHash: Hash,
    fileName: z.literal("resume.docx"), mimeType: z.literal("application/vnd.openxmlformats-officedocument.wordprocessingml.document") }).strict(),
  target: Control.extend({ alternative: Control.optional(), picker: z.object({ forId: z.literal("resume"), label: z.literal("Attach"), groupLabel: z.string().min(1).max(1000) }).strict().optional() }).strict(),
  state: z.enum(["prepared", "running", "attached", "stopped"]), consumed: z.boolean(),
  receipt: z.object({ reservationId: z.string(), outputHash: Hash, byteSize: z.number().int().positive(), verifiedAt: z.string().datetime() }).strict().nullable(),
}).strict();
export type AtsAttachment = z.infer<typeof AttachmentSchema>;
const ExecutionSchema = z.object({
  id: z.string(), taskId: z.string(), planId: z.string(), planHash: Hash, reviewsHash: Hash,
  challenge: z.string().uuid(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), holdExpiresAt: z.string().datetime(),
  state: z.enum(["awaiting_authorization", "running", "filled", "stopped", "closed"]), consumed: z.boolean(),
  receipts: z.array(z.object({ questionId: z.string(), reservationId: z.string(), verifiedAt: z.string().datetime() }).strict()),
  attachment: AttachmentSchema.optional(),
}).strict();
export type AtsExecution = z.infer<typeof ExecutionSchema>;
const store = createJsonStore({ fileName: "ats-executions.json", schema: z.object({ version: z.literal(1), sessions: z.array(ExecutionSchema) }).strict(),
  empty: () => ({ version: 1 as const, sessions: [] as AtsExecution[] }) });
export const readAtsExecutions = store.read;
export const updateAtsExecutions = store.update;
