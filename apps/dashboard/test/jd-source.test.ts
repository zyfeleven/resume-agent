import { describe, expect, it } from "vitest";

import { JdSourceError, MAX_JD_BYTES, readJdSource } from "../lib/jd-source";

describe("readJdSource", () => {
  it("normalizes pasted text and hashes it", () => {
    const source = readJdSource("Requirements\r\n- 5+ years of design experience.\r\n");

    expect(source.text).toBe("Requirements\n- 5+ years of design experience.");
    expect(source.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.artifactId).toBe(`artifact:${source.contentHash.slice(0, 24)}`);
    expect(source.storedFileName).toBe(`${source.contentHash}.txt`);
    expect(source.byteSize).toBe(source.bytes.byteLength);
  });

  it("gives the same artifact identity to the same posting", () => {
    expect(readJdSource("Requirements\n- 5+ years.\n").contentHash).toBe(
      readJdSource("  Requirements\n- 5+ years.  ").contentHash,
    );
  });

  it("refuses an empty or non-text body", () => {
    expect(() => readJdSource("")).toThrow(JdSourceError);
    expect(() => readJdSource("   \n\n ")).toThrow(/paste the job description/i);
    expect(() => readJdSource(undefined)).toThrow(JdSourceError);
    expect(() => readJdSource({ text: "Requirements" })).toThrow(JdSourceError);
  });

  it("refuses a posting above the paste limit", () => {
    expect(() => readJdSource("x".repeat(MAX_JD_BYTES + 1))).toThrow(/limit/i);
  });
});
