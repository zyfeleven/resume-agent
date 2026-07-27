import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0" as const;

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .meta({ description: "Stable application-scoped entity identifier." });

export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .meta({ description: "RFC 3339 timestamp with an explicit UTC offset." });

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .meta({ description: "Lowercase SHA-256 digest." });

export const HttpUrlSchema = z
  .string()
  .url()
  .regex(/^https?:\/\//i)
  .meta({ description: "HTTP or HTTPS URL. Domain authorization is enforced by policy." });

export const DataSensitivitySchema = z.enum(["normal", "pii", "sensitive", "secret"]);

export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;

export const JsonValueSchema: z.ZodType<
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const SourceLocatorSchema = z
  .object({
    artifactId: EntityIdSchema,
    locator: z.string().min(1).max(500),
    excerpt: z.string().max(2_000).optional(),
  })
  .strict();

export const EntityTimestampsSchema = z
  .object({
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type DataSensitivity = z.infer<typeof DataSensitivitySchema>;
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
