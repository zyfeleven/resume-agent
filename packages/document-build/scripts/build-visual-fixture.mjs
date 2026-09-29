import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildResumeDocx } from "../dist/index.js";

const output = resolve(process.argv[2] ?? "visual-output/classic-resume.docx");
const now = "2026-07-28T12:00:00-04:00";
const profileId = "profile:visual-fixture";

function fact(id, kind, key, value) {
  return {
    id,
    profileId,
    kind,
    key,
    value,
    status: "verified",
    verification: { verifiedBy: "user:fixture", verifiedAt: now },
    sensitivity: kind === "identity" || kind === "contact" ? "pii" : "normal",
    sources: [{ artifactId: "artifact:synthetic-resume", locator: `fixture:${id}`, excerpt: value }],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

const facts = [
  fact("fact:name", "identity", "full_name", "Maya Chen"),
  fact("fact:email", "contact", "email", "maya.chen@example.com"),
  fact("fact:phone", "contact", "phone", "+1 416 555 0142"),
  fact("fact:location", "contact", "location", "Toronto, ON"),
  fact("fact:summary", "achievement", "summary", "Product designer with eight years of experience building accessible enterprise tools and design systems."),
  fact("fact:role1", "employment", "role.1", "Senior Product Designer"),
  fact("fact:org1", "employment", "organization.1", "Northstar Labs"),
  fact("fact:dates1", "employment", "dates.1", "Jan 2021 - Present"),
  fact("fact:b1", "achievement", "achievement.1", "Led the redesign of an analytics workspace used by 4,000 internal reviewers, reducing task completion time by 31%."),
  fact("fact:b2", "achievement", "achievement.2", "Created an accessible component library adopted by six product teams across web and mobile workflows."),
  fact("fact:b3", "achievement", "achievement.3", "Partnered with engineering and research to turn complex audit requirements into clear, testable interaction patterns."),
  fact("fact:role2", "employment", "role.2", "Product Designer"),
  fact("fact:org2", "employment", "organization.2", "Harbour Systems"),
  fact("fact:dates2", "employment", "dates.2", "Jun 2018 - Dec 2020"),
  fact("fact:b4", "achievement", "achievement.4", "Designed onboarding and reporting flows for a B2B platform serving operations teams in Canada and the United States."),
  fact("fact:b5", "achievement", "achievement.5", "Established reusable discovery templates that shortened research synthesis from five days to two."),
  fact("fact:skills", "skill", "skills", "Figma | Design systems | Accessibility | Prototyping | User research | TypeScript"),
  fact("fact:project", "project", "project.1", "Open-source accessibility checklist - Maintainer of a practical WCAG review guide used by local design meetups."),
  fact("fact:education", "education", "education.1", "BDes, Interaction Design - Emily Carr University of Art + Design"),
];

const item = (id, text, factId) => ({ id, text, factIds: [factId], requirementIds: [] });
const resume = {
  profileId,
  headerFactIds: ["fact:name", "fact:email", "fact:phone", "fact:location"],
  summary: [item("item:summary", facts[4].value, "fact:summary")],
  skills: [item("item:skills", facts[16].value, "fact:skills")],
  experience: [
    {
      id: "experience:1",
      roleFactId: "fact:role1",
      organizationFactId: "fact:org1",
      dateFactIds: ["fact:dates1"],
      bullets: [
        item("item:b1", facts[8].value, "fact:b1"),
        item("item:b2", facts[9].value, "fact:b2"),
        item("item:b3", facts[10].value, "fact:b3"),
      ],
    },
    {
      id: "experience:2",
      roleFactId: "fact:role2",
      organizationFactId: "fact:org2",
      dateFactIds: ["fact:dates2"],
      bullets: [
        item("item:b4", facts[14].value, "fact:b4"),
        item("item:b5", facts[15].value, "fact:b5"),
      ],
    },
  ],
  projects: [item("item:project", facts[17].value, "fact:project")],
  education: [item("item:education", facts[18].value, "fact:education")],
};

const document = buildResumeDocx(resume, facts);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, document.bytes);
process.stdout.write(`${output}\n`);
