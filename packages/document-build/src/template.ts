import { createHash } from "node:crypto";

export const CLASSIC_RESUME_TEMPLATE_ID = "template:classic-single-column";
export const CLASSIC_RESUME_TEMPLATE_VERSION = "classic-single-column-v1";

/**
 * One immutable, ATS-safe resume template.
 *
 * It follows the compact-reference preset with named resume overrides: 0.7 inch
 * margins, 10 point body type, a 22 point name, and no tables, columns, text boxes,
 * images, or floating shapes. All layout values are explicit OOXML values.
 */
export const CLASSIC_RESUME_TEMPLATE = {
  id: CLASSIC_RESUME_TEMPLATE_ID,
  version: CLASSIC_RESUME_TEMPLATE_VERSION,
  name: "Classic single-column",
  page: {
    widthDxa: 12_240,
    heightDxa: 15_840,
    marginDxa: 1_008,
    headerDxa: 432,
    footerDxa: 432,
  },
  styles: {
    name: "ResumeName",
    contact: "ResumeContact",
    heading: "ResumeSection",
    entry_heading: "ResumeEntryHeading",
    entry_meta: "ResumeEntryMeta",
    bullet: "ResumeBullet",
    line: "ResumeLine",
  },
} as const;

export const CLASSIC_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeName"><w:name w:val="Resume Name"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeContact"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="0" w:after="40" w:line="528" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="17365D"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeContact"><w:name w:val="Resume Contact"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeSection"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="0" w:after="160" w:line="216" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="4B5563"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeSection"><w:name w:val="Resume Section"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeLine"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="60" w:line="264" w:lineRule="exact"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="9FBAD0"/></w:pBdr></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:caps/><w:color w:val="17365D"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:spacing w:val="12"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeEntryHeading"><w:name w:val="Resume Entry Heading"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeEntryMeta"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="0" w:line="252" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="1F2937"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeEntryMeta"><w:name w:val="Resume Entry Meta"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeBullet"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="40" w:line="216" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="4B5563"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeBullet"><w:name w:val="Resume Bullet"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeBullet"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ResumeLine"><w:name w:val="Resume Line"/><w:basedOn w:val="Normal"/><w:next w:val="ResumeLine"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="50" w:line="240" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>`;

export const CLASSIC_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

export const CLASSIC_SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

export const CLASSIC_SECTION_XML = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008" w:header="432" w:footer="432" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

export const CLASSIC_TEMPLATE_HASH = createHash("sha256")
  .update([CLASSIC_STYLES_XML, CLASSIC_NUMBERING_XML, CLASSIC_SETTINGS_XML, CLASSIC_SECTION_XML].join("\n"))
  .digest("hex");

export function resolveResumeTemplate(templateId: string = CLASSIC_RESUME_TEMPLATE_ID) {
  if (templateId === "template:default" || templateId === CLASSIC_RESUME_TEMPLATE_ID) {
    return { ...CLASSIC_RESUME_TEMPLATE, hash: CLASSIC_TEMPLATE_HASH };
  }
  throw new Error(`Unknown resume template ${templateId}.`);
}
