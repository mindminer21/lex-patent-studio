import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { exportWatermark } from "@/lib/domain/review";
import type { WorkProductDocument } from "@/lib/domain/schemas";
import { EXPORT_DISCLAIMER } from "./manifest";

/**
 * USPTO-style DOCX rendering (FR-8):
 *  - Times New Roman, 12 pt
 *  - double-spaced body text
 *  - 1.5" left margin (1" top/right/bottom)
 *  - "DRAFT — NOT REVIEWED" watermark header on every page unless the
 *    document's review state is approved-by-human (§9.6.4)
 */

export const USPTO_FONT = "Times New Roman";
export const USPTO_FONT_SIZE_HALF_POINTS = 24; // 12 pt
export const USPTO_LINE_DOUBLE = 480; // 240 = single, 480 = double
export const TWIPS_PER_INCH = 1440;
export const USPTO_MARGINS = {
  top: TWIPS_PER_INCH,
  right: TWIPS_PER_INCH,
  bottom: TWIPS_PER_INCH,
  left: Math.round(TWIPS_PER_INCH * 1.5), // 2160 twips = 1.5"
};

/**
 * Structural plan for the DOCX — exposed separately so the watermark and
 * formatting rules are unit-testable without unzipping OOXML.
 */
export interface DocxPlan {
  watermark: string | null;
  headerLines: string[];
  paragraphs: { text: string; kind: "title" | "meta" | "heading" | "body" | "flag" }[];
  footerText: string;
}

export function planDocx(document: WorkProductDocument): DocxPlan {
  const watermark = exportWatermark(document.reviewState);
  const paragraphs: DocxPlan["paragraphs"] = [];

  paragraphs.push({ text: document.title, kind: "title" });
  paragraphs.push({
    text: `Work tier ${document.tier} · Review state: ${document.reviewState.replaceAll("_", " ")} · Verification: ${document.verificationState} · Version ${document.version} (hash ${document.versionHash}) · Model ${document.modelId} · ${document.corpusRelease}`,
    kind: "meta",
  });

  for (const section of document.sections) {
    paragraphs.push({ text: section.heading, kind: "heading" });
    paragraphs.push({ text: section.body, kind: "body" });
    for (const flag of section.flags) {
      paragraphs.push({ text: `[REVIEWER FLAG] ${flag}`, kind: "flag" });
    }
  }

  return {
    watermark,
    headerLines: watermark ? [watermark] : [],
    paragraphs,
    footerText: EXPORT_DISCLAIMER,
  };
}

function run(text: string, opts: { bold?: boolean; italics?: boolean; caps?: boolean } = {}) {
  return new TextRun({
    text,
    font: USPTO_FONT,
    size: USPTO_FONT_SIZE_HALF_POINTS,
    bold: opts.bold,
    italics: opts.italics,
    allCaps: opts.caps,
  });
}

export async function renderUsptoDocx(document: WorkProductDocument): Promise<Buffer> {
  const plan = planDocx(document);

  const children: Paragraph[] = plan.paragraphs.map((p) => {
    switch (p.kind) {
      case "title":
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: USPTO_LINE_DOUBLE, after: 240 },
          children: [run(p.text, { bold: true, caps: true })],
        });
      case "meta":
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: 240, after: 360 },
          children: [
            new TextRun({ text: p.text, font: USPTO_FONT, size: 20, italics: true }),
          ],
        });
      case "heading":
        return new Paragraph({
          spacing: { line: USPTO_LINE_DOUBLE, before: 240 },
          children: [run(p.text, { bold: true, caps: true })],
        });
      case "flag":
        return new Paragraph({
          spacing: { line: USPTO_LINE_DOUBLE },
          children: [run(p.text, { italics: true, bold: true })],
        });
      default:
        return new Paragraph({
          spacing: { line: USPTO_LINE_DOUBLE },
          children: [run(p.text)],
        });
    }
  });

  const header = new Header({
    children: plan.headerLines.map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: line,
              font: USPTO_FONT,
              size: USPTO_FONT_SIZE_HALF_POINTS,
              bold: true,
              color: "808080",
            }),
          ],
        }),
    ),
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: plan.footerText, font: USPTO_FONT, size: 16 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font: USPTO_FONT, size: 20 }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Lex Patent Studio (local mode — synthetic content)",
    title: document.title,
    sections: [
      {
        properties: { page: { margin: USPTO_MARGINS } },
        headers: { default: header },
        footers: { default: footer },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
