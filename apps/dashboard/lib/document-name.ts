import type { Job } from "@resume-agent/contracts";

/** A readable download name. Storage still keys on the content hash, not on this. */
export function documentFileName(job?: Pick<Job, "title" | "company">): string {
  const slug = `${job?.company ?? ""} ${job?.title ?? ""}`
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${slug.length > 0 ? slug : "resume"}.docx`;
}
