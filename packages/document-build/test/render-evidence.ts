import type { DocumentRenderEvidence, ResumeDocumentBuild } from "@resume-agent/contracts";

import {
  computeDocumentRenderEvidenceHash,
  computeVisualBaselineHash,
  computeVisualComparisonHash,
} from "../src/index.js";

export function trustedRenderEvidence(
  build: ResumeDocumentBuild,
  inspectedAt: string,
  overrides: Partial<Omit<DocumentRenderEvidence, "evidenceHash">> = {},
): DocumentRenderEvidence {
  const pages = overrides.pages ?? [
    {
      pageNumber: 1,
      imageHash: "7".repeat(64),
      widthPixels: 1275,
      heightPixels: 1650,
      dpi: 150,
      inspectedAt,
      clipping: false,
      overlap: false,
      missingGlyph: false,
      fontFallback: false,
      bulletMisalignment: false,
      unexpectedPageBreak: false,
      unexpectedBlankPage: false,
    },
  ];
  const visualBaselineHash = overrides.visualBaselineHash ?? computeVisualBaselineHash(build);
  const withoutHash: Omit<DocumentRenderEvidence, "evidenceHash"> = {
    buildId: build.id,
    outputHash: build.outputHash,
    templateHash: build.templateHash ?? "0".repeat(64),
    rendererName: "trusted-test-renderer",
    rendererVersion: "1.0.0",
    renderedAt: inspectedAt,
    pageCount: pages.length,
    pages,
    visualBaselineHash,
    visualComparisonHash: computeVisualComparisonHash(visualBaselineHash, pages),
    visualRegressionPassed: true,
    ...overrides,
  };
  return { ...withoutHash, evidenceHash: computeDocumentRenderEvidenceHash(withoutHash) };
}
