import { describe, expect, it } from "vitest";

import { mergeParsedRequirements, parseJobDescription } from "../src/index.js";

function parse(jobId: string, text: string) {
  return parseJobDescription({
    jobId,
    source: { artifactId: `artifact:${jobId.replace(/[^a-z]/g, "")}`, contentHash: "a".repeat(64), byteSize: 500 },
    text,
    parsedAt: "2026-07-28T04:00:00-04:00",
  });
}

describe("job-description safety boundaries", () => {
  it("refuses to merge requirements from different jobs", () => {
    const first = parse("job:one", "Requirements\n- Experience with TypeScript.").requirements;
    const second = parse("job:two", "Requirements\n- Experience with React.").requirements;
    expect(() => mergeParsedRequirements(first, second)).toThrow(/different jobs/i);
  });

  it("drops a credential-like line without copying its value into results", () => {
    const secret = "sk-1234567890abcdefghijklmnop";
    const result = parse(
      "job:one",
      `Requirements\n- Experience with TypeScript.\n- API key ${secret}`,
    );

    expect(result.report.skipped.some((entry) => entry.reason === "possible_secret")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
