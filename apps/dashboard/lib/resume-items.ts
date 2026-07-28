import type { ResumeContentItem, ResumeIR } from "@resume-agent/contracts";

export interface ResumeItemRef {
  item: ResumeContentItem;
  section: "summary" | "experience" | "skills" | "projects" | "education";
}

/** Every content item in a resume, in the order a reader would meet it. */
export function resumeItems(resume: ResumeIR): ResumeItemRef[] {
  return [
    ...resume.summary.map((item) => ({ item, section: "summary" as const })),
    ...resume.experience.flatMap((entry) => entry.bullets.map((item) => ({ item, section: "experience" as const }))),
    ...resume.skills.map((item) => ({ item, section: "skills" as const })),
    ...resume.projects.map((item) => ({ item, section: "projects" as const })),
    ...resume.education.map((item) => ({ item, section: "education" as const })),
  ];
}
