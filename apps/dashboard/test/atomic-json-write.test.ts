import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomically } from "../lib/atomic-json-write";

const io = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn(), rm: vi.fn(), write: vi.fn(), close: vi.fn(), delay: vi.fn(), platform: vi.fn() }));
vi.mock("node:fs/promises", () => ({ open: io.open, rename: io.rename, rm: io.rm }));
vi.mock("node:os", () => ({ platform: io.platform }));
vi.mock("node:timers/promises", () => ({ setTimeout: io.delay }));
const failure = (code: string) => Object.assign(new Error("SIMULATED"), { code });

describe("atomic JSON publication", () => {
  beforeEach(() => {
    vi.resetAllMocks(); io.platform.mockReturnValue("win32");
    io.open.mockResolvedValue({ writeFile: io.write, close: io.close });
    for (const fn of [io.rename, io.rm, io.write, io.close, io.delay]) fn.mockResolvedValue(undefined);
  });
  it("writes one exclusive staging file, closes it, then atomically publishes it", async () => {
    await writeJsonAtomically("/fixture/state.json", '{"count":1}');
    const temporary = io.open.mock.calls[0]![0];
    expect(temporary).toMatch(/^\/fixture\/state\.json\.[0-9a-f-]{36}\.tmp$/);
    expect(io.open).toHaveBeenCalledWith(temporary, "wx");
    expect(io.write).toHaveBeenCalledExactlyOnceWith('{"count":1}', "utf8");
    expect(io.close.mock.invocationCallOrder[0]).toBeLessThan(io.rename.mock.invocationCallOrder[0]!);
    expect(io.rename).toHaveBeenCalledExactlyOnceWith(temporary, "/fixture/state.json");
    expect(io.rm).toHaveBeenCalledExactlyOnceWith(temporary, { force: true });
    expect(io.delay).not.toHaveBeenCalled();
  });
  it.each(["EPERM", "EBUSY"])("retries only the same Windows rename after %s", async code => {
    io.rename.mockRejectedValueOnce(failure(code)).mockRejectedValueOnce(failure(code));
    await writeJsonAtomically("/fixture/state.json", "{}");
    expect(io.rename).toHaveBeenCalledTimes(3); expect(io.delay.mock.calls).toEqual([[20], [50]]);
    expect(io.rename.mock.calls.every(call => JSON.stringify(call) === JSON.stringify(io.rename.mock.calls[0]))).toBe(true);
    expect(io.open).toHaveBeenCalledOnce(); expect(io.write).toHaveBeenCalledOnce(); expect(io.close).toHaveBeenCalledOnce();
  });
  it("stops after five attempts, preserves the final error and cleans only staging", async () => {
    const error = failure("EPERM"); io.rename.mockRejectedValue(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.rename).toHaveBeenCalledTimes(5); expect(io.delay.mock.calls).toEqual([[20], [50], [100], [200]]);
    expect(io.rm).toHaveBeenCalledExactlyOnceWith(io.open.mock.calls[0]![0], { force: true });
    expect(io.rm.mock.calls.some(([file]) => file === "/fixture/state.json")).toBe(false);
  });
  it.each(["EACCES", "ENOENT", "ENOSPC", "EXDEV", "EIO"])("does not retry %s", async code => {
    const error = failure(code); io.rename.mockRejectedValue(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.rename).toHaveBeenCalledOnce(); expect(io.delay).not.toHaveBeenCalled();
  });
  it.each(["linux", "darwin"])("does not reinterpret permission errors on %s", async platform => {
    io.platform.mockReturnValue(platform); const error = failure("EPERM"); io.rename.mockRejectedValue(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.rename).toHaveBeenCalledOnce(); expect(io.delay).not.toHaveBeenCalled();
  });
  it("stops immediately when a retried error changes to a non-retryable failure", async () => {
    const error = failure("EIO"); io.rename.mockRejectedValueOnce(failure("EPERM")).mockRejectedValueOnce(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.rename).toHaveBeenCalledTimes(2); expect(io.delay.mock.calls).toEqual([[20]]);
  });
  it("does not delete a staging file it failed to create exclusively", async () => {
    const error = failure("EEXIST"); io.open.mockRejectedValue(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.write).not.toHaveBeenCalled(); expect(io.rename).not.toHaveBeenCalled(); expect(io.rm).not.toHaveBeenCalled();
  });
  it("cleans partial writes and does not publish them", async () => {
    const error = failure("ENOSPC"); io.write.mockRejectedValue(error);
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
    expect(io.close).toHaveBeenCalledOnce(); expect(io.rename).not.toHaveBeenCalled(); expect(io.delay).not.toHaveBeenCalled(); expect(io.rm).toHaveBeenCalledOnce();
  });
  it("does not publish when the staging handle cannot close", async () => {
    io.close.mockRejectedValue(failure("EIO"));
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toMatchObject({ code: "EIO" });
    expect(io.rename).not.toHaveBeenCalled(); expect(io.rm).toHaveBeenCalledOnce();
  });
  it("preserves the primary failure if staging cleanup also fails", async () => {
    const error = failure("EIO"); io.rename.mockRejectedValue(error); io.rm.mockRejectedValue(failure("EPERM"));
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).rejects.toBe(error);
  });
  it("does not report a successful commit as failed due to cleanup", async () => {
    io.rm.mockRejectedValue(failure("EPERM"));
    await expect(writeJsonAtomically("/fixture/state.json", "{}")).resolves.toBeUndefined();
    expect(io.rename).toHaveBeenCalledOnce();
  });
  it("does not reuse a prior temporary file name", async () => {
    await writeJsonAtomically("/fixture/state.json", "{}"); await writeJsonAtomically("/fixture/state.json", "{}");
    expect(io.open.mock.calls[0]![0]).not.toBe(io.open.mock.calls[1]![0]);
  });
});
