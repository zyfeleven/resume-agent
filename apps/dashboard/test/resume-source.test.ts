import { describe, expect, it } from "vitest";

import { MAX_SOURCE_BYTES, ResumeSourceError, readResumeSource } from "../lib/resume-source";

function upload(name: string, contents: string | Uint8Array<ArrayBuffer>): File {
  return new File([contents], name);
}

describe("readResumeSource", () => {
  it("reads a plain-text resume and hashes the uploaded bytes", async () => {
    const source = await readResumeSource(upload("master-resume.txt", "Maya Chen\nmaya.chen@example.com\n"));

    expect(source.format).toBe("plain_text");
    expect(source.text).toContain("Maya Chen");
    expect(source.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.artifactId).toBe(`artifact:${source.contentHash.slice(0, 24)}`);
    expect(source.storedFileName).toBe(`${source.contentHash}.txt`);
  });

  it("refuses formats that have no parser yet", async () => {
    await expect(readResumeSource(upload("master-resume.pdf", "%PDF-1.7"))).rejects.toThrow(ResumeSourceError);
    await expect(readResumeSource(upload("master-resume.pdf", "%PDF-1.7"))).rejects.toThrow(/export the resume as \.docx/i);
    await expect(readResumeSource(upload("resume.rtf", "{\\rtf1}"))).rejects.toThrow(/\.docx, \.txt, \.md/);
  });

  it("refuses a file that is empty or has no readable text", async () => {
    await expect(readResumeSource(upload("master-resume.txt", ""))).rejects.toThrow(/empty/i);
    await expect(readResumeSource(upload("master-resume.txt", "   \n\n"))).rejects.toThrow(/no readable text/i);
  });

  it("refuses a file above the import limit", async () => {
    const oversized = new Uint8Array(MAX_SOURCE_BYTES + 1);
    await expect(readResumeSource(upload("master-resume.txt", oversized))).rejects.toThrow(/import limit/i);
  });

  it("never trusts a directory path in the uploaded file name", async () => {
    const source = await readResumeSource(upload("C:/Users/maya/Documents/master-resume.txt", "Maya Chen\n"));
    expect(source.fileName).toBe("master-resume.txt");

    await expect(readResumeSource(upload("../../.env", "SECRET=1"))).rejects.toThrow(ResumeSourceError);
  });
});
