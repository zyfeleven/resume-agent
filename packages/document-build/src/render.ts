import type {
  DocumentRenderedPageEvidence,
  DocumentRenderEvidence,
  ResumeDocumentBuild,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  computeDocumentRenderEvidenceHash,
  computeVisualBaselineHash,
  computeVisualComparisonHash,
} from "./quality.js";

const RENDER_DPI = 150;
const COMMAND_TIMEOUT_MS = 60_000;
const SECTION_HEADINGS = new Set(["summary", "experience", "skills", "projects", "education"]);

interface RendererExecutables {
  libreOffice: string;
  pdfToPpm: string;
  pdfToText: string;
  pdfFonts: string;
}

interface WordBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface RenderedPageLayout {
  widthPoints: number;
  heightPoints: number;
  words: WordBox[];
}

export interface RenderInspectionInput {
  bboxHtml: string;
  layoutText: string;
  fontReport: string;
  expectedLines: readonly string[];
  expectedBulletCount: number;
}

export interface RenderInspectionPage {
  clipping: boolean;
  overlap: boolean;
  missingGlyph: boolean;
  fontFallback: boolean;
  bulletMisalignment: boolean;
  unexpectedPageBreak: boolean;
  unexpectedBlankPage: boolean;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandOutput(executable: string, args: readonly string[]): string {
  try {
    return execFileSync(executable, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }).trim();
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? String((error as { stdout?: unknown }).stdout ?? "").trim()
        : "";
    throw new Error([`Local document renderer command failed: ${path.basename(executable)}.`, stderr, stdout].filter(Boolean).join(" "));
  }
}

function whereExecutable(name: string): string | undefined {
  try {
    return execFileSync("where.exe", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /\.(?:com|exe)$/i.test(entry) && existsSync(entry));
  } catch {
    return undefined;
  }
}

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function resolveRendererExecutables(): RendererExecutables | undefined {
  const libreOffice = firstExisting([
    process.env.RESUME_AGENT_LIBREOFFICE_PATH,
    whereExecutable("soffice.com"),
    "C:\\Program Files\\LibreOffice\\program\\soffice.com",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
  ]);
  const pdfToPpm = firstExisting([
    process.env.RESUME_AGENT_PDFTOPPM_PATH,
    whereExecutable("pdftoppm.exe"),
  ]);
  const pdfToText = firstExisting([
    process.env.RESUME_AGENT_PDFTOTEXT_PATH,
    whereExecutable("pdftotext.exe"),
  ]);
  const pdfFonts = firstExisting([
    process.env.RESUME_AGENT_PDFFONTS_PATH,
    whereExecutable("pdffonts.exe"),
  ]);
  return libreOffice && pdfToPpm && pdfToText && pdfFonts
    ? { libreOffice, pdfToPpm, pdfToText, pdfFonts }
    : undefined;
}

export function localDocumentRendererAvailable(): boolean {
  return resolveRendererExecutables() !== undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function numericAttribute(tag: string, name: string): number {
  const match = tag.match(new RegExp(`${name}="([0-9.]+)"`));
  return Number(match?.[1] ?? Number.NaN);
}

function parsePageLayouts(bboxHtml: string): RenderedPageLayout[] {
  return [...bboxHtml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)].map((pageMatch) => {
    const attributes = pageMatch[1] ?? "";
    const body = pageMatch[2] ?? "";
    const words = [...body.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map((wordMatch) => ({
      text: decodeXml((wordMatch[2] ?? "").replace(/<[^>]+>/g, "")),
      xMin: numericAttribute(wordMatch[1] ?? "", "xMin"),
      yMin: numericAttribute(wordMatch[1] ?? "", "yMin"),
      xMax: numericAttribute(wordMatch[1] ?? "", "xMax"),
      yMax: numericAttribute(wordMatch[1] ?? "", "yMax"),
    }));
    return {
      widthPoints: numericAttribute(attributes, "width"),
      heightPoints: numericAttribute(attributes, "height"),
      words,
    };
  });
}

function hasSubstantialOverlap(words: readonly WordBox[]): boolean {
  const sorted = [...words].sort((left, right) => left.yMin - right.yMin || left.xMin - right.xMin);
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex];
    if (!left) continue;
    const leftArea = Math.max(0, left.xMax - left.xMin) * Math.max(0, left.yMax - left.yMin);
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex];
      if (!right || right.yMin >= left.yMax) break;
      const width = Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin);
      const height = Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin);
      if (width <= 0.75 || height <= 0.75) continue;
      const rightArea = Math.max(0, right.xMax - right.xMin) * Math.max(0, right.yMax - right.yMin);
      if (width * height >= Math.min(leftArea, rightArea) * 0.2) return true;
    }
  }
  return false;
}

function textTokens(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isSubsequence(expected: readonly string[], actual: readonly string[]): boolean {
  let expectedIndex = 0;
  for (const token of actual) {
    if (token === expected[expectedIndex]) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}

function fontsFromReport(report: string): string[] {
  return report
    .split(/\r?\n/)
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

/** Inspect Poppler geometry/text/font output without trusting browser-supplied claims. */
export function inspectRenderedResume(input: RenderInspectionInput): RenderInspectionPage[] {
  const layouts = parsePageLayouts(input.bboxHtml);
  if (layouts.length === 0) throw new Error("Poppler did not return page geometry for the rendered document.");

  const expectedTokens = textTokens(input.expectedLines.join("\n"));
  const actualTokens = textTokens(input.layoutText);
  const globalMissingGlyph =
    /\uFFFD/.test(input.layoutText) || expectedTokens.length === 0 || !isSubsequence(expectedTokens, actualTokens);
  const fonts = fontsFromReport(input.fontReport);
  const fontFallback = fonts.length === 0 || fonts.some((font) => !font.replace(/^[A-Z]{6}\+/, "").toLowerCase().includes("arial"));
  const bulletWords = layouts.flatMap((page) => page.words).filter((word) => /^[\u2022\u25E6\u25AA\uF0B7]$/.test(word.text));
  const bulletMisalignment =
    input.expectedBulletCount > 0 &&
    (bulletWords.length !== input.expectedBulletCount ||
      Math.max(...bulletWords.map((word) => word.xMin)) - Math.min(...bulletWords.map((word) => word.xMin)) > 1.5);
  const textPages = input.layoutText.split("\f");

  return layouts.map((page, pageIndex) => {
    const invalidGeometry = page.words.some((word) =>
      [word.xMin, word.yMin, word.xMax, word.yMax].some((value) => !Number.isFinite(value)),
    );
    const clipping = invalidGeometry || page.words.some(
      (word) => word.xMin < 0.5 || word.yMin < 0.5 || word.xMax > page.widthPoints - 0.5 || word.yMax > page.heightPoints - 0.5,
    );
    const pageText = (textPages[pageIndex] ?? "").trim();
    const lines = pageText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const lastLine = lines.at(-1)?.toLocaleLowerCase("en-US") ?? "";
    return {
      clipping,
      overlap: hasSubstantialOverlap(page.words),
      missingGlyph: pageIndex === 0 ? globalMissingGlyph : /\uFFFD/.test(pageText),
      fontFallback,
      bulletMisalignment,
      unexpectedPageBreak: pageIndex < layouts.length - 1 && SECTION_HEADINGS.has(lastLine),
      unexpectedBlankPage: page.words.length === 0 || pageText.length === 0,
    };
  });
}

export function readPngDimensions(bytes: Uint8Array): { widthPixels: number; heightPixels: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error("The page renderer returned a file that is not a valid PNG image.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { widthPixels: view.getUint32(16), heightPixels: view.getUint32(20) };
}

function rendererVersion(executables: RendererExecutables): string {
  const libreOffice = commandOutput(executables.libreOffice, ["--version"]).replace(/\s+/g, " ");
  const popplerResult = spawnSync(executables.pdfToPpm, ["-v"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    windowsHide: true,
  });
  const match = `${popplerResult.stdout ?? ""}\n${popplerResult.stderr ?? ""}`.match(
    /pdftoppm version\s+([^\s]+)/i,
  );
  const poppler = match?.[1] ? `Poppler ${match[1]}` : "Poppler local";
  return `${libreOffice}; ${poppler}`.slice(0, 160);
}

/** Render exact DOCX bytes with local LibreOffice + Poppler and produce hash-bound QA evidence. */
export function renderResumeDocumentEvidence(input: {
  build: ResumeDocumentBuild;
  bytes: Uint8Array;
  renderedAt: string;
}): DocumentRenderEvidence {
  const executables = resolveRendererExecutables();
  if (!executables) {
    throw new Error(
      "The trusted local DOCX renderer requires LibreOffice plus pdftoppm, pdftotext, and pdffonts.",
    );
  }
  if (!input.build.templateHash) throw new Error("The document build has no immutable template hash.");

  const workDirectory = mkdtempSync(path.join(tmpdir(), "resume-agent-render-"));
  try {
    const sourcePath = path.join(workDirectory, "resume.docx");
    const pdfPath = path.join(workDirectory, "resume.pdf");
    const profilePath = path.join(workDirectory, "libreoffice-profile");
    const imagePrefix = path.join(workDirectory, "page");
    const bboxPath = path.join(workDirectory, "bbox.html");
    const layoutPath = path.join(workDirectory, "layout.txt");
    writeFileSync(sourcePath, input.bytes);

    commandOutput(executables.libreOffice, [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--norestore",
      `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      workDirectory,
      sourcePath,
    ]);
    if (!existsSync(pdfPath) || readFileSync(pdfPath).byteLength === 0) {
      throw new Error("LibreOffice completed without producing a non-empty PDF.");
    }

    commandOutput(executables.pdfToPpm, ["-png", "-r", String(RENDER_DPI), pdfPath, imagePrefix]);
    commandOutput(executables.pdfToText, ["-bbox-layout", "-enc", "UTF-8", pdfPath, bboxPath]);
    commandOutput(executables.pdfToText, ["-layout", "-enc", "UTF-8", pdfPath, layoutPath]);
    const fontReport = commandOutput(executables.pdfFonts, [pdfPath]);
    const bboxHtml = readFileSync(bboxPath, "utf8");
    const layoutText = readFileSync(layoutPath, "utf8");
    const expectedBulletCount = input.build.blocks.filter((block) => block.style === "bullet").length;
    const inspection = inspectRenderedResume({
      bboxHtml,
      layoutText,
      fontReport,
      expectedLines: input.build.blocks.map((block) => block.text),
      expectedBulletCount,
    });
    const pagePaths = readdirSync(workDirectory)
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    if (pagePaths.length === 0 || pagePaths.length !== inspection.length) {
      throw new Error("The rendered page images do not match Poppler's page geometry output.");
    }

    const pages: DocumentRenderedPageEvidence[] = pagePaths.map((name, index) => {
      const imageBytes = readFileSync(path.join(workDirectory, name));
      const dimensions = readPngDimensions(imageBytes);
      const defects = inspection[index];
      if (!defects) throw new Error(`Page ${index + 1} has no visual inspection result.`);
      return {
        pageNumber: index + 1,
        imageHash: sha256(imageBytes),
        ...dimensions,
        dpi: RENDER_DPI,
        inspectedAt: input.renderedAt,
        ...defects,
      };
    });
    const visualBaselineHash = computeVisualBaselineHash(input.build);
    const withoutHash: Omit<DocumentRenderEvidence, "evidenceHash"> = {
      buildId: input.build.id,
      outputHash: input.build.outputHash,
      templateHash: input.build.templateHash,
      rendererName: "libreoffice-poppler-local-inspector",
      rendererVersion: rendererVersion(executables),
      renderedAt: input.renderedAt,
      pageCount: pages.length,
      pages,
      visualBaselineHash,
      visualComparisonHash: computeVisualComparisonHash(visualBaselineHash, pages),
      visualRegressionPassed: pages.every((page) =>
        !page.clipping &&
        !page.overlap &&
        !page.missingGlyph &&
        !page.fontFallback &&
        !page.bulletMisalignment &&
        !page.unexpectedPageBreak &&
        !page.unexpectedBlankPage,
      ),
    };
    return { ...withoutHash, evidenceHash: computeDocumentRenderEvidenceHash(withoutHash) };
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}
