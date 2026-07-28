import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { artifactDirectory, createJsonStore, dataDirectory, writeArtifactFile } from "../lib/local-store";

const CounterSchema = z.object({ count: z.number().int().nonnegative() }).strict();

describe("local JSON and artifact storage", () => {
  let temporaryDirectory = "";
  const originalDataDirectory = process.env.RESUME_AGENT_DATA_DIR;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "resume-agent-store-"));
    process.env.RESUME_AGENT_DATA_DIR = temporaryDirectory;
  });

  afterEach(async () => {
    if (originalDataDirectory === undefined) {
      delete process.env.RESUME_AGENT_DATA_DIR;
    } else {
      process.env.RESUME_AGENT_DATA_DIR = originalDataDirectory;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("returns an empty value when the store does not exist", async () => {
    const store = createJsonStore({ fileName: "counter.json", schema: CounterSchema, empty: () => ({ count: 0 }) });
    await expect(store.read()).resolves.toEqual({ count: 0 });
  });

  it("serializes concurrent updates without losing a write", async () => {
    const store = createJsonStore({ fileName: "counter.json", schema: CounterSchema, empty: () => ({ count: 0 }) });
    await Promise.all(Array.from({ length: 12 }, () => store.update((current) => ({ count: current.count + 1 }))));
    await expect(store.read()).resolves.toEqual({ count: 12 });
  });

  it("fails closed when stored JSON no longer matches its schema", async () => {
    await writeFile(path.join(dataDirectory(), "counter.json"), JSON.stringify({ count: -1 }), "utf8");
    const store = createJsonStore({ fileName: "counter.json", schema: CounterSchema, empty: () => ({ count: 0 }) });
    await expect(store.read()).rejects.toThrow();
  });

  it("refuses artifact file names that can escape their scope", async () => {
    await expect(writeArtifactFile("documents", "../outside.docx", new Uint8Array([1]))).rejects.toThrow(
      /plain file names/i,
    );
    await expect(writeArtifactFile("documents", "nested/outside.docx", new Uint8Array([1]))).rejects.toThrow(
      /plain file names/i,
    );
  });

  it("clears both the JSON store and its scoped artifacts", async () => {
    const store = createJsonStore({
      fileName: "counter.json",
      schema: CounterSchema,
      empty: () => ({ count: 0 }),
      artifactScope: "documents",
    });
    await store.update(() => ({ count: 1 }));
    await writeArtifactFile("documents", "safe.docx", new Uint8Array([1, 2, 3]));

    await expect(store.clear()).resolves.toEqual({ count: 0 });
    await expect(readFile(path.join(artifactDirectory("documents"), "safe.docx"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
