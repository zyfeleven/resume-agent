import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toJSONSchema } from "zod";

import { CONTRACT_VERSION, schemaRegistry } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(packageRoot, "schemas");

await mkdir(outputDirectory, { recursive: true });

for (const [name, schema] of Object.entries(schemaRegistry)) {
  const jsonSchema = toJSONSchema(schema, {
    target: "draft-2020-12",
    reused: "ref",
  });

  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://resume-agent.dev/schemas/${CONTRACT_VERSION}/${name}.json`,
    title: name,
    "x-contract-version": CONTRACT_VERSION,
    ...jsonSchema,
  };

  await writeFile(
    resolve(outputDirectory, `${name}.json`),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}
