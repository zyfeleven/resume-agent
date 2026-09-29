import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createJsonStore } from "../lib/local-store";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
vi.mock("node:os", async importOriginal => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, platform: vi.fn(os.platform) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const schema = z.object({ count: z.number().int().nonnegative() }).strict();
const fault = () => Object.assign(new Error("SIMULATED rename failure"), { code: "EPERM" });

describe("JSON store recovery without business-action replay", () => {
  let directory: string; let target: string;
  const store = createJsonStore({ fileName: "counter.json", schema, empty: () => ({ count: 0 }) });
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "store-recovery-")); target = path.join(directory, "counter.json");
    vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    vi.mocked(platform).mockReturnValue("win32");
    vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
    await writeFile(target, '{"count":0}\n', "utf8");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    // This exact directory was created by this test, never a workspace/data root.
    await rm(directory, { recursive: true, force: true });
  });
  it("publishes the same staged bytes after transient failures and calls mutate once", async () => {
    const staged: string[] = [];
    vi.mocked(rename).mockImplementationOnce(async source => { staged.push(await readFile(source, "utf8")); throw fault(); })
      .mockImplementationOnce(async source => { staged.push(await readFile(source, "utf8")); throw fault(); });
    const mutate = vi.fn(current => ({ count: current.count + 1 }));
    await expect(store.update(mutate)).resolves.toEqual({ count: 1 });
    expect(mutate).toHaveBeenCalledOnce(); expect(rename).toHaveBeenCalledTimes(3);
    expect(staged).toEqual([await readFile(target, "utf8"), await readFile(target, "utf8")]);
    expect(await readdir(directory)).toEqual(["counter.json"]);
  });
  it("keeps old bytes on exhaustion, cleans staging and releases the queue for later work", async () => {
    const old = await readFile(target, "utf8"); const error = fault(); vi.mocked(rename).mockRejectedValue(error);
    const mutate = vi.fn(current => ({ count: current.count + 1 }));
    await expect(store.update(mutate)).rejects.toBe(error);
    expect(mutate).toHaveBeenCalledOnce(); expect(rename).toHaveBeenCalledTimes(5);
    expect(await readFile(target, "utf8")).toBe(old); expect(await readdir(directory)).toEqual(["counter.json"]);
    vi.mocked(rename).mockImplementation(actualFs.rename);
    await expect(store.update(current => ({ count: current.count + 1 }))).resolves.toEqual({ count: 1 });
  });
  it("holds the common write queue until replacement finishes and readers still see old data", async () => {
    let reached!: () => void; let release!: () => void;
    const ready = new Promise<void>(r => { reached = r; }); const gate = new Promise<void>(r => { release = r; });
    vi.mocked(rename).mockRejectedValueOnce(fault()).mockImplementationOnce(async (from, to) => { reached(); await gate; await actualFs.rename(from, to); });
    const firstMutate = vi.fn(current => ({ count: current.count + 1 })); const secondMutate = vi.fn(current => ({ count: current.count + 1 }));
    const first = store.update(firstMutate); const second = store.update(secondMutate);
    try {
      await ready;
      expect(secondMutate).not.toHaveBeenCalled(); expect(await store.read()).toEqual({ count: 0 });
    } finally { release(); await Promise.all([first, second]); }
    expect(firstMutate).toHaveBeenCalledOnce(); expect(secondMutate).toHaveBeenCalledOnce(); expect(await store.read()).toEqual({ count: 2 });
  });
  it("keeps a transaction on its original directory when configuration changes during mutate", async () => {
    const other = path.join(directory, "other"); await mkdir(other);
    await store.update(current => { vi.stubEnv("RESUME_AGENT_DATA_DIR", other); return { count: current.count + 1 }; });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ count: 1 }); expect(await readdir(other)).toEqual([]);
  });
  it("does not overwrite or promote a leftover legacy staging file", async () => {
    await writeFile(`${target}.tmp`, "UNCOMMITTED_FIXTURE", "utf8");
    await store.update(() => ({ count: 1 })); await store.update(() => ({ count: 2 }));
    expect(await readFile(`${target}.tmp`, "utf8")).toBe("UNCOMMITTED_FIXTURE");
    expect(await store.read()).toEqual({ count: 2 }); expect((await readdir(directory)).sort()).toEqual(["counter.json", "counter.json.tmp"]);
  });
  it("never stages invalid state", async () => {
    await expect(store.update(() => ({ count: -1 }))).rejects.toThrow();
    expect(rename).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual(["counter.json"]); expect(await store.read()).toEqual({ count: 0 });
  });
  it("preserves all 200 concurrent updates on the real local filesystem", async () => {
    await Promise.all(Array.from({ length: 200 }, () => store.update(current => ({ count: current.count + 1 }))));
    expect(await store.read()).toEqual({ count: 200 }); expect(await readdir(directory)).toEqual(["counter.json"]);
  });
});
