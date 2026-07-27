import { z } from "zod";

import {
  DataSensitivitySchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  Sha256Schema,
} from "./common.js";

export const ArtifactKindSchema = z.enum([
  "source_resume",
  "tailored_resume",
  "job_description",
  "cover_letter",
  "screenshot",
  "browser_trace",
  "document_render",
  "submission_receipt",
  "manifest",
  "other",
]);

export const ArtifactSchema = z
  .object({
    id: EntityIdSchema,
    kind: ArtifactKindSchema,
    fileName: z
      .string()
      .min(1)
      .max(500)
      .regex(/^(?!\.{1,2}$)[^/\\\u0000]+$/),
    mediaType: z.string().min(1).max(200),
    contentHash: Sha256Schema,
    byteSize: z.number().int().nonnegative(),
    storageKey: z
      .string()
      .min(1)
      .max(1_000)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    sensitivity: DataSensitivitySchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const AuditActorTypeSchema = z.enum(["user", "agent", "service", "policy_engine"]);

export const AuditEventSchema = z
  .object({
    id: EntityIdSchema,
    runId: EntityIdSchema.optional(),
    applicationId: EntityIdSchema.optional(),
    actorType: AuditActorTypeSchema,
    actorId: EntityIdSchema,
    eventType: z.string().min(1).max(240),
    payload: z.record(z.string(), JsonValueSchema),
    redacted: z.boolean(),
    previousEventHash: Sha256Schema.optional(),
    eventHash: Sha256Schema,
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export type Artifact = z.infer<typeof ArtifactSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
