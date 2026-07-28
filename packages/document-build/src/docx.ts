import {
  ResumeDocumentBlockSchema,
  type Fact,
  type ResumeDocumentBlock,
  type ResumeIR,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { readZip, writeZip } from "./zip.js";

export const BUILDER_NAME = "resume-agent-docx";
export const BUILDER_VERSION = "docx-build-v1";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;

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
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

/** Paragraph and run formatting per style. Kept inline so the package needs no style catalogue. */
const STYLE_FORMATTING: Record<BlockStyle, { paragraph: string; run: string }> = {
  name: { paragraph: `<w:spacing w:after="40"/>`, run: `<w:b/><w:sz w:val="36"/>` },
  contact: { paragraph: `<w:spacing w:after="240"/>`, run: `<w:color w:val="444444"/>` },
  heading: { paragraph: `<w:spacing w:before="240" w:after="80"/>`, run: `<w:b/><w:caps/><w:sz w:val="22"/>` },
  entry_heading: { paragraph: `<w:spacing w:before="120" w:after="0"/>`, run: `<w:b/>` },
  entry_meta: { paragraph: `<w:spacing w:after="60"/>`, run: `<w:i/><w:color w:val="444444"/>` },
  bullet: { paragraph: `<w:ind w:left="360" w:hanging="180"/><w:spacing w:after="40"/>`, run: `` },
  line: { paragraph: `<w:spacing w:after="40"/>`, run: `` },
};

function paragraph(block: DraftBlock): string {
  const format = STYLE_FORMATTING[block.style];
  const runProperties = format.run.length > 0 ? `<w:rPr>${format.run}</w:rPr>` : "";
  // The bullet glyph is presentation, so it is not part of the block's recorded text.
  const text = block.style === "bullet" ? `• ${block.text}` : block.text;

  return `<w:p><w:pPr>${format.paragraph}</w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Lay the approved resume out as document blocks.
 *
 * Every block records the verified facts its text came from. A block with no fact behind
 * it cannot be represented, so a generated document has no unattributable line.
 */
export function planDocumentBlocks(resume: ResumeIR, facts: readonly Fact[]): DraftBlock[] {
  const verified = new Map<string, Fact>(
    facts.filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact]),
  );
  const blocks: DraftBlock[] = [];

  const headerFacts = resume.headerFactIds
    .map((factId) => verified.get(factId))
    .filter((fact): fact is Fact => Boolean(fact));

  const nameFact = headerFacts.find((fact) => fact.kind === "identity");
  if (nameFact) {
    blocks.push({ section: "header", style: "name", text: factText(nameFact), factIds: [nameFact.id] });
  }

  const contactFacts = headerFacts.filter((fact) => fact.id !== nameFact?.id);
  if (contactFacts.length > 0) {
    blocks.push({
      section: "header",
      style: "contact",
      text: contactFacts.map(factText).join(" · "),
      factIds: contactFacts.map((fact) => fact.id),
    });
  }

  const addSection = (section: BlockSection, heading: string, items: ResumeIR["summary"], style: BlockStyle) => {
    if (items.length === 0) {
      return;
    }
    const headingFactIds = [...new Set(items.flatMap((item) => item.factIds))];
    blocks.push({ section, style: "heading", text: heading, factIds: headingFactIds });
    for (const item of items) {
      blocks.push({ section, style, text: item.text, factIds: item.factIds, contentItemId: item.id });
    }
  };

  addSection("summary", "Summary", resume.summary, "line");

  if (resume.experience.length > 0) {
    const experienceFactIds = [
      ...new Set(
        resume.experience.flatMap((entry) => [entry.roleFactId, entry.organizationFactId, ...entry.dateFactIds]),
      ),
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
          text: `${factText(role)} — ${factText(organization)}`,
          factIds: [role.id, organization.id],
        });
      }
      if (dates.length > 0) {
        blocks.push({
          section: "experience",
          style: "entry_meta",
          text: dates.map(factText).join(" · "),
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
    // Skills read as one line; each one still cites its own fact through the joined block.
    blocks.push({
      section: "skills",
      style: "line",
      text: resume.skills.map((item) => item.text).join(" · "),
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
}

/** Build a `.docx` package from an approved resume. Deterministic for identical input. */
export function buildResumeDocx(resume: ResumeIR, facts: readonly Fact[]): DocxDocument {
  const draft = planDocumentBlocks(resume, facts);
  if (draft.length === 0) {
    throw new Error("An approved resume must contain at least one line before it can be built.");
  }

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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;

  const encoder = new TextEncoder();
  const bytes = writeZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(DOCUMENT_RELS) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/styles.xml", data: encoder.encode(STYLES) },
  ]);

  const text = extractDocxText(bytes);
  return { bytes, contentHash: sha256(bytes), documentTextHash: sha256(text), text, blocks };
}

/**
 * Read the text back out of a built package.
 *
 * Verification re-reads the bytes that were written instead of trusting the builder's
 * own report of what it wrote.
 */
export function extractDocxText(bytes: Uint8Array): string {
  const documentXml = readZip(bytes).get("word/document.xml");
  if (!documentXml) {
    throw new Error("This package has no word/document.xml part.");
  }

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
