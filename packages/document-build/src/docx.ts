import {
  ResumeDocumentBlockSchema,
  type Fact,
  type ResumeDocumentBlock,
  type ResumeIR,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import {
  CLASSIC_NUMBERING_XML,
  CLASSIC_RESUME_TEMPLATE_ID,
  CLASSIC_SECTION_XML,
  CLASSIC_SETTINGS_XML,
  CLASSIC_STYLES_XML,
  CLASSIC_TEMPLATE_HASH,
  resolveResumeTemplate,
} from "./template.js";
import { readZip, writeZip } from "./zip.js";

export const BUILDER_NAME = "resume-agent-docx";
export const BUILDER_VERSION = "docx-build-v2";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;

type BlockStyle = ResumeDocumentBlock["style"];
type BlockSection = ResumeDocumentBlock["section"];

interface DraftBlock {
  section: BlockSection;
  style: BlockStyle;
  text: string;
  factIds: string[];
  contentItemId?: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

function paragraph(block: DraftBlock): string {
  const template = resolveResumeTemplate();
  const numbering = block.style === "bullet" ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : "";
  return `<w:p><w:pPr><w:pStyle w:val="${template.styles[block.style]}"/>${numbering}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
}

/** Lay approved content into the template slots without adding unattributable text. */
export function planDocumentBlocks(resume: ResumeIR, facts: readonly Fact[]): DraftBlock[] {
  const verified = new Map<string, Fact>(
    facts.filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact]),
  );
  const blocks: DraftBlock[] = [];
  const headerFacts = resume.headerFactIds
    .map((factId) => verified.get(factId))
    .filter((fact): fact is Fact => Boolean(fact));

  const nameFact = headerFacts.find((fact) => fact.kind === "identity");
  if (nameFact) blocks.push({ section: "header", style: "name", text: factText(nameFact), factIds: [nameFact.id] });

  const contactFacts = headerFacts.filter((fact) => fact.id !== nameFact?.id);
  if (contactFacts.length > 0) {
    blocks.push({
      section: "header",
      style: "contact",
      text: contactFacts.map(factText).join(" | "),
      factIds: contactFacts.map((fact) => fact.id),
    });
  }

  const addSection = (section: BlockSection, heading: string, items: ResumeIR["summary"], style: BlockStyle) => {
    if (items.length === 0) return;
    blocks.push({ section, style: "heading", text: heading, factIds: [...new Set(items.flatMap((item) => item.factIds))] });
    for (const item of items) {
      blocks.push({ section, style, text: item.text, factIds: item.factIds, contentItemId: item.id });
    }
  };

  addSection("summary", "Summary", resume.summary, "line");

  if (resume.experience.length > 0) {
    const experienceFactIds = [
      ...new Set(resume.experience.flatMap((entry) => [entry.roleFactId, entry.organizationFactId, ...entry.dateFactIds])),
    ];
    blocks.push({ section: "experience", style: "heading", text: "Experience", factIds: experienceFactIds });

    for (const entry of resume.experience) {
      const role = verified.get(entry.roleFactId);
      const organization = verified.get(entry.organizationFactId);
      const dates = entry.dateFactIds
        .map((factId) => verified.get(factId))
        .filter((fact): fact is Fact => Boolean(fact));

      if (role && organization) {
        blocks.push({
          section: "experience",
          style: "entry_heading",
          text: `${factText(role)} - ${factText(organization)}`,
          factIds: [role.id, organization.id],
        });
      }
      if (dates.length > 0) {
        blocks.push({
          section: "experience",
          style: "entry_meta",
          text: dates.map(factText).join(" | "),
          factIds: dates.map((fact) => fact.id),
        });
      }
      for (const bullet of entry.bullets) {
        blocks.push({
          section: "experience",
          style: "bullet",
          text: bullet.text,
          factIds: bullet.factIds,
          contentItemId: bullet.id,
        });
      }
    }
  }

  if (resume.skills.length > 0) {
    blocks.push({
      section: "skills",
      style: "heading",
      text: "Skills",
      factIds: [...new Set(resume.skills.flatMap((item) => item.factIds))],
    });
    blocks.push({
      section: "skills",
      style: "line",
      text: resume.skills.map((item) => item.text).join(" | "),
      factIds: [...new Set(resume.skills.flatMap((item) => item.factIds))],
    });
  }

  addSection("projects", "Projects", resume.projects, "line");
  addSection("education", "Education", resume.education, "line");
  return blocks;
}

export interface DocxDocument {
  bytes: Uint8Array;
  contentHash: string;
  documentTextHash: string;
  text: string;
  blocks: ResumeDocumentBlock[];
  templateId: string;
  templateVersion: string;
  templateHash: string;
}

/** Build deterministic approved content inside the immutable classic template. */
export function buildResumeDocx(
  resume: ResumeIR,
  facts: readonly Fact[],
  templateId: string = CLASSIC_RESUME_TEMPLATE_ID,
): DocxDocument {
  const template = resolveResumeTemplate(templateId);
  const draft = planDocumentBlocks(resume, facts);
  if (draft.length === 0) throw new Error("An approved resume must contain at least one line before it can be built.");

  const blocks = draft.map((block, index) =>
    ResumeDocumentBlockSchema.parse({
      blockId: `block:${String(index + 1).padStart(4, "0")}`,
      section: block.section,
      style: block.style,
      text: block.text,
      textHash: sha256(block.text),
      factIds: block.factIds,
      ...(block.contentItemId === undefined ? {} : { contentItemId: block.contentItemId }),
    }),
  );

  const body = draft.map(paragraph).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${CLASSIC_SECTION_XML}</w:body></w:document>`;
  const encoder = new TextEncoder();
  const bytes = writeZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(DOCUMENT_RELS) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/styles.xml", data: encoder.encode(CLASSIC_STYLES_XML) },
    { name: "word/numbering.xml", data: encoder.encode(CLASSIC_NUMBERING_XML) },
    { name: "word/settings.xml", data: encoder.encode(CLASSIC_SETTINGS_XML) },
  ]);

  const text = extractDocxText(bytes);
  return {
    bytes,
    contentHash: sha256(bytes),
    documentTextHash: sha256(text),
    text,
    blocks,
    templateId: template.id,
    templateVersion: template.version,
    templateHash: template.hash,
  };
}

/** Independently verify immutable template parts and page geometry in built bytes. */
export function hasClassicTemplateFingerprint(bytes: Uint8Array): boolean {
  const entries = readZip(bytes);
  const decode = (name: string) => {
    const value = entries.get(name);
    return value ? new TextDecoder().decode(value) : null;
  };
  return (
    decode("word/styles.xml") === CLASSIC_STYLES_XML &&
    decode("word/numbering.xml") === CLASSIC_NUMBERING_XML &&
    decode("word/settings.xml") === CLASSIC_SETTINGS_XML &&
    (decode("word/document.xml")?.includes(CLASSIC_SECTION_XML) ?? false)
  );
}

export function extractDocxText(bytes: Uint8Array): string {
  const documentXml = readZip(bytes).get("word/document.xml");
  if (!documentXml) throw new Error("This package has no word/document.xml part.");

  const xml = new TextDecoder().decode(documentXml);
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((match) =>
      [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((run) =>
          (run[1] ?? "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&"),
        )
        .join(""),
    )
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export { CLASSIC_TEMPLATE_HASH };
